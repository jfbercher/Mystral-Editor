/**
 * Le Python que les moteurs partagent.
 *
 * Lister un espace de noms, en retirer une variable, le mettre de cote et le
 * remettre : ces quatre verbes du contrat (`cellRuntime.js`) se rendent, pour
 * un moteur Python, par du Python. Celui-ci tourne tel quel dans Pyodide et
 * dans un CPython, et il n'y a donc aucune raison de l'ecrire deux fois -- la
 * seconde copie serait celle qu'on oublie de corriger.
 *
 * Ce qui reste propre a chaque moteur est son transport : Pyodide pose un
 * dictionnaire par `globals().set` et lit la valeur de retour, un noyau recoit
 * du code et rend du texte sur un canal. Les fonctions ci-dessous ne
 * connaissent ni l'un ni l'autre : elles prennent l'espace de noms en argument
 * et rendent du JSON.
 *
 * Tous les noms commencent par `_`, ce qui les fait epargner par le
 * redemarrage doux de Pyodide et ignorer par le panneau de variables.
 *
 * Les blocs Python sont des litteraux JS : pas de guillemet oblique dedans,
 * pas de `${`. Les commentaires y sont ecrits sans accents, pour la meme
 * raison que ceux de `Preview.js` le sont.
 */

/**
 * Introspection : ce que le panneau de variables et `%whos` affichent.
 *
 * `ns=None` vaut `globals()`, c'est-a-dire `__main__` -- l'espace partage. Un
 * espace isole est un dictionnaire que l'appelant passe explicitement.
 */
export const NAMESPACE_HELPERS_PY = `
import sys as _sys_vi, json as _json_vi

_MYSTRAL_HIDDEN_TYPES = ('module', 'function', 'builtin_function_or_method',
                         'method', 'type', 'ufunc', '_Feature', 'classmethod',
                         'staticmethod', 'JsProxy')

# Les noms que le moteur lui-meme pose dans l'espace de noms, et qui ne sont
# pas des variables de l'utilisateur. Vide ici : chaque moteur la remplit pour
# son propre compte au demarrage -- un noyau IPython y met In, Out et exit, un
# autre y mettra autre chose. Les cacher par leur type ne suffirait pas : In
# est une liste et Out un dictionnaire, aussi ordinaires que ceux du document.
#
# (Commentaires sans accents ni guillemets obliques : ce bloc voyage dans un
# litteral JS, et le guillemet oblique y fermerait la chaine.)
_MYSTRAL_HIDDEN_NAMES = set()

def _mystral_size(x):
    # sys.getsizeof lies about arrays and frames: it reports the wrapper, not
    # the buffer. Ask the object itself when it knows better.
    t = type(x).__name__
    try:
        if t in ('ndarray', 'Series'):
            return int(x.nbytes)
        if t == 'DataFrame':
            return int(x.memory_usage(deep=False).sum())
        return _sys_vi.getsizeof(x)
    except Exception:
        return -1

def _mystral_shape(x):
    try:
        s = getattr(x, 'shape', None)
        if s is not None:
            return ' x '.join(str(d) for d in s)
        if isinstance(x, (list, tuple, dict, set, frozenset, str, bytes)):
            return str(len(x))
    except Exception:
        pass
    return ''

def _mystral_preview(x, limit=200):
    try:
        text = repr(x)
    except Exception as e:
        return '<unrepresentable: %s>' % type(e).__name__
    text = ' '.join(text.split())
    return text if len(text) <= limit else text[:limit - 3] + '...'

def _mystral_varlist(include_all=False, ns=None):
    # ns is the namespace to look at. Defaulting to globals() here means
    # __main__, since this function is defined there -- which is exactly the
    # shared namespace, so an unqualified call keeps its old meaning.
    ns = globals() if ns is None else ns
    out = []
    for _k, _v in list(ns.items()):
        if _k.startswith('_') or _k in _MYSTRAL_HIDDEN_NAMES:
            continue
        t = type(_v).__name__
        if not include_all and t in _MYSTRAL_HIDDEN_TYPES:
            continue
        out.append({'name': _k, 'type': t, 'size': _mystral_size(_v),
                    'shape': _mystral_shape(_v), 'preview': _mystral_preview(_v)})
    out.sort(key=lambda d: d['name'].lower())
    return out

def _mystral_varlist_json(include_all=False, ns=None):
    return _json_vi.dumps(_mystral_varlist(include_all, ns))

def _mystral_human_size(n):
    if n is None or n < 0:
        return '?'
    for unit in ('B', 'kB', 'MB', 'GB'):
        if n < 1024 or unit == 'GB':
            return ('%d %s' % (n, unit)) if unit == 'B' else ('%.1f %s' % (n, unit))
        n /= 1024.0

def _mystral_whos(include_all=False, ns=None):
    rows = _mystral_varlist(include_all, ns)
    if not rows:
        print('No variables defined.')
        return
    head = ('Variable', 'Type', 'Size', 'Shape', 'Value')
    cells = [head] + [(r['name'], r['type'], _mystral_human_size(r['size']),
                       r['shape'], r['preview'][:60]) for r in rows]
    widths = [max(len(c[i]) for c in cells) for i in range(len(head))]
    for i, row in enumerate(cells):
        print('  '.join(v.ljust(widths[j]) for j, v in enumerate(row)).rstrip())
        if i == 0:
            print('  '.join('-' * w for w in widths))

def _mystral_delete(names, unload=False, ns=None):
    # Removing the name is all that is needed for data. For a module, dropping
    # it from sys.modules too is what actually lets it be re-imported fresh --
    # but any object still referencing it keeps the old module alive, so this
    # frees memory only when nothing else holds on.
    import types as _t_del
    ns = globals() if ns is None else ns
    removed = []
    for _n_del in names:
        if _n_del not in ns:
            continue
        _v_del = ns[_n_del]
        del ns[_n_del]
        removed.append(_n_del)
        if unload and isinstance(_v_del, _t_del.ModuleType):
            _sys_vi.modules.pop(getattr(_v_del, '__name__', ''), None)
    return _json_vi.dumps(removed)

def _mystral_who(include_all=False, ns=None):
    names = [r['name'] for r in _mystral_varlist(include_all, ns)]
    print('  '.join(names) if names else 'No variables defined.')
`;

/**
 * Persistance : l'espace de noms comme quelque chose de stockable, et le
 * chemin du retour.
 *
 * Le pickler est choisi a l'execution. `cloudpickle` sait serialiser une
 * fonction definie dans une cellule, ce que `pickle` ne sait pas ; mais
 * `cloudpickle` est garanti dans Pyodide et pas dans le noyau de quelqu'un
 * d'autre. Plutot que d'exiger une installation, on prend celui qui est la et
 * on note, variable par variable, ce qui n'a pas pu etre enregistre -- la
 * mecanique d'alerte existante dit deja le reste a l'utilisateur.
 *
 * Les deux fonctions prennent et rendent du JSON : c'est la seule forme qui
 * traverse aussi bien un appel Pyodide qu'un canal de noyau.
 */
export const PERSISTENCE_HELPERS_PY = `
def _mystral_snapshot(ns=None, skip=()):
    import base64 as _b64, io as _io, types as _types
    try:
        import cloudpickle as _pk
    except ImportError:
        # Sans cloudpickle, les fonctions et les classes definies dans une
        # cellule ne passeront pas. Elles sont comptees comme non enregistrees,
        # et le document le dira : c'est une restauration partielle annoncee,
        # pas une perte silencieuse.
        import pickle as _pk
    ns = globals() if ns is None else ns
    skip = frozenset(skip) | _MYSTRAL_HIDDEN_NAMES
    out = {}
    for _n, _v in list(ns.items()):
        if _n.startswith('_') or _n in skip:
            continue
        # Un module n'est pas une donnee de l'utilisateur. cloudpickle en garde
        # une reference dont la relecture reimporte le paquet, ce qui echoue
        # dans un runtime neuf tant qu'il n'est pas charge -- c'est ce qui
        # faisait croire np et pd perdus. On garde le nom, et la restauration
        # l'importe proprement.
        if isinstance(_v, _types.ModuleType):
            out[_n] = {"module": _v.__name__}
            continue
        try:
            _buf = _io.BytesIO()
            _pk.dump(_v, _buf)
            out[_n] = {"data": _b64.b64encode(_buf.getvalue()).decode(), "type": type(_v).__name__}
        except Exception as _e:
            out[_n] = {"skipped": True, "reason": str(_e)}
    return out


def _mystral_snapshot_json(ns=None, skip=()):
    return _json_vi.dumps(_mystral_snapshot(ns, skip))


def _mystral_restore(data, ns=None):
    import base64 as _b64, importlib as _il, types as _types
    try:
        import cloudpickle as _pk
    except ImportError:
        import pickle as _pk
    ns = globals() if ns is None else ns
    ok, failed, never_saved = [], {}, {}
    for _n, _e in data.items():
        if _e.get('skipped'):
            # Note a l'enregistrement : celle-ci n'a jamais ete dans le
            # sidecar. La compter comme un echec de restauration ramenait la
            # meme alerte a chaque ouverture, pour des variables auxquelles le
            # document ne pouvait rien. Elle est signalee a part, en console.
            never_saved[_n] = _e.get('reason', 'not persisted')
            continue
        try:
            if 'module' in _e:
                ns[_n] = _il.import_module(_e['module'])
            else:
                ns[_n] = _pk.loads(_b64.b64decode(_e['data']))
            ok.append(_n)
        except Exception as _err:
            # Un import qui echoue ici n'est pas une donnee perdue : le module
            # a ete installe ou ecrit par les cellules de ce document, qui
            # n'ont pas encore tourne dans ce runtime neuf. Les executer le
            # ramene. De meme pour un objet dont la classe vit dans un tel
            # module. C'est une note, pas l'alarme que merite une valeur
            # vraiment irrecuperable.
            _kind = 'import' if isinstance(_err, ImportError) else 'error'
            failed[_n] = {'reason': type(_err).__name__ + ': ' + str(_err), 'kind': _kind}

    # cloudpickle reconstruit une fonction avec une copie privee des globales
    # qu'elle lit, de sorte qu'une fonction restauree cesse de suivre l'espace
    # d'ou elle vient : apres un rechargement, une cellule posant CONST = 100
    # laisserait une f() restauree lire encore le 41 avec lequel elle a ete
    # enregistree, et deux fonctions restaurees ne partageraient meme pas leurs
    # globales. On les relie a l'espace vivant -- meme code, meme fermeture,
    # memes valeurs par defaut -- pour qu'elles restent en phase, comme elles
    # l'etaient avant la fermeture du document. Les methodes d'une classe
    # restauree gardent la leur : celle-la est dans l'objet classe, hors
    # d'atteinte d'ici.
    relinked = 0
    _own_module = ns.get('__name__', '__main__')
    for _n_rl in ok:
        _f_rl = ns.get(_n_rl)
        if not isinstance(_f_rl, _types.FunctionType) or _f_rl.__globals__ is ns:
            continue
        # Only what this document defined. A function imported from a library
        # is restored by reference and already carries its own module globals:
        # rebuilding it on the namespace cut it off from everything its module
        # had imported, and the failure came back as the library's own name --
        # "NameError: name 'curstate' is not defined" from inside bokeh's
        # show(), for a reader who had never heard of curstate. The test is the
        # module the function says it belongs to, which cloudpickle preserves
        # on both paths.
        if getattr(_f_rl, '__module__', None) not in (None, _own_module, '__main__'):
            continue
        _g_rl = _types.FunctionType(_f_rl.__code__, ns, _f_rl.__name__,
                                    _f_rl.__defaults__, _f_rl.__closure__)
        _g_rl.__dict__.update(_f_rl.__dict__)
        _g_rl.__kwdefaults__ = _f_rl.__kwdefaults__
        _g_rl.__annotations__ = _f_rl.__annotations__
        _g_rl.__qualname__ = _f_rl.__qualname__
        _g_rl.__doc__ = _f_rl.__doc__
        _g_rl.__module__ = _f_rl.__module__
        ns[_n_rl] = _g_rl
        relinked += 1

    return {'ok': ok, 'failed': failed, 'relinked': relinked, 'never_saved': never_saved}


def _mystral_restore_json(payload, ns=None):
    return _json_vi.dumps(_mystral_restore(_json_vi.loads(payload), ns))
`;

/**
 * Declarer les noms que ce moteur-ci pose lui-meme dans l'espace de noms.
 *
 * A executer apres les deux blocs ci-dessus. Les noms declares disparaissent
 * du panneau et ne sont pas enregistres : ils appartiennent au moteur, pas au
 * document, et seront la de toute facon au prochain demarrage.
 */
export const hideNamesPy = (names) => `_MYSTRAL_HIDDEN_NAMES.update(${JSON.stringify(names)})`;
