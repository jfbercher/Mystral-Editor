import { useContext, useEffect, useState } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import { Compartment } from "@codemirror/state";
import { useSignalEffect } from "@preact/signals";
import { openConfigFile, openNewFileTemplate } from "../config";
import { showToast } from "../utils/utils_ui";
import { isTauri } from "../utils/local_utils/fs.js";
import { installLocalPyodide, localPyodideStatus, removeLocalPyodide, missingLocalWheels, PYODIDE_VERSION } from "../utils/local_utils/pyodideInstall.js";
import { config } from "../config.js";

const SettingsList = styled.div`
  width: 240px;

  h1 {
    font-size: 20px;
    margin: 0;
  }

  ul {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-height: 400px;
    overflow-y: auto;
    scrollbar-width: thin;
    margin: 0;
    margin-top: 16px;
  }

  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  p {
    margin: 0;
  }

  .settings-config {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border, #ccc);
  }

  .settings-config button {
    font: inherit;
    cursor: pointer;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid var(--border, #ccc);
    background: transparent;
    color: inherit;
    width: 100%;
    text-align: left;
  }

  .settings-config small {
    display: block;
    margin-top: 6px;
    opacity: .7;
  }
`;

const ToggleContainer = styled.span`
  input {
    display: none;
  }

  label {
    display: block;
    width: 48px;
    height: 24px;
    border-radius: 12px;
    transition: 0.4s;
    cursor: pointer;
    position: relative;
    background-color: var(--switch-bg);

    &::before {
      content: "";
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: white;
      left: 4px;
      top: 4px;
      transition: 0.4s;
    }
  }

  input:checked + label {
    background-color: var(--switch-active-bg);

    &::before {
      transform: translateX(24px);
    }
  }
`;

const Toggle = ({ ...props }) => {
  return (
    <ToggleContainer>
      <input type="checkbox" {...props} />
      <label htmlFor={props.id} title="Toggle setting" />
    </ToggleContainer>
  );
};

export const userExtensionsCompartment = new Compartment();

/**
 * Install, show and remove the local Pyodide.
 *
 * The state shown is read from the folder, never remembered here or in the
 * configuration: a witness file is the only thing that says an install is
 * complete, and it is read again after every action.
 */
const OfflinePython = () => {
  const [status, setStatus] = useState(null);
  const [missing, setMissing] = useState([]);
  const [busy, setBusy] = useState(null);

  // Read from the folder when the panel opens, and again after every action:
  // what is on disk is the answer, and it can change outside this component --
  // the folder fills itself whenever a cell asks for a package.
  const reread = async () => {
    setStatus(await localPyodideStatus());
    setMissing((await missingLocalWheels(config.pyodide?.offlinePackages ?? [])).missing);
  };
  useEffect(() => {
    reread();
  }, []);

  if (!isTauri()) return null;

  const install = async () => {
    setBusy({ done: 0, total: 0, name: "" });
    try {
      const extraPackages = config.pyodide?.offlinePackages ?? [];
      const { files, bytes } = await installLocalPyodide({ onProgress: setBusy, extraPackages });
      showToast(
        `Python is installed for offline use: ${files} files, ${(bytes / 1e6).toFixed(0)} MB` +
          (extraPackages.length ? `, including ${extraPackages.join(", ")}.` : "."),
        "success",
        8000,
      );
    } catch (err) {
      // The folder keeps what was downloaded but has no witness, so it is not
      // used; saying so spares the reader the worry of a half-installed state.
      showToast(`The download stopped: ${err?.message ?? err}. Nothing is used until it completes; try again to resume.`, "error", 0);
    } finally {
      setBusy(null);
      await reread();
    }
  };

  const forget = async () => {
    setBusy({ removing: true });
    try {
      await removeLocalPyodide();
      showToast("The local Python was removed; cells will use the network again.", "success", 6000);
    } catch (err) {
      showToast(`Could not remove it: ${err?.message ?? err}`, "error", 0);
    } finally {
      setBusy(null);
      await reread();
    }
  };

  if (busy) {
    const label = busy.removing
      ? "Removing…"
      : busy.total
        ? `Downloading ${busy.done}/${busy.total} — ${(busy.bytes / 1e6).toFixed(0)} MB`
        : "Reading the package list…";
    return (
      <div className="settings-config">
        <button type="button" disabled>{label}</button>
        <small>{busy.name ?? ""}</small>
      </div>
    );
  }

  const extras = config.pyodide?.offlinePackages ?? [];

  // Shown only when it has work to do -- and what settles that is the folder,
  // not the configuration. A declared list that is already downloaded leaves
  // nothing to add, and a button that does nothing is worse than no button.
  // Running it costs only what is missing: every file already there and sound
  // is skipped.
  const canComplete = !status?.installed || missing.length > 0;

  // The panel is 240px wide, so what is written under the buttons says the
  // state and stops there; the rest -- where the folder is, what it holds, how
  // it grows -- is a tooltip, and the reference is in the documentation. A
  // paragraph under every button turns a settings panel into a manual nobody
  // reads twice.
  const hint = status?.installed
    ? `${status.dir}\n\n` +
      (extras.length ? `Declared in pyodide.offlinePackages: ${extras.join(", ")}.` : "Only numpy, matplotlib and the helpers were downloaded.") +
      "\n\nThe folder also fills itself as packages are used: a cell asking for one that is missing fetches it. Declaring names in pyodide.offlinePackages is how to have them before going offline."
    : "Downloads Pyodide, its standard library and the packages of the default set into the application's data folder, once. Cells then run with no network at all.\n\nPackages beyond numpy and matplotlib are fetched as they are used, or ahead of time by naming them in pyodide.offlinePackages.";

  return (
    <div className="settings-config">
      {canComplete && (
        <button type="button" title={hint} onClick={install}>
          {status?.installed ? `Download ${missing.length} missing package${missing.length === 1 ? "" : "s"}` : "Install Python for offline use (~50 MB)"}
        </button>
      )}
      {status?.installed && (
        <button type="button" style={canComplete ? "margin-top: 0.5em;" : ""} title={hint} onClick={forget}>
          {`Remove the offline Python (${PYODIDE_VERSION})`}
        </button>
      )}
      <small title={hint}>{status?.installed ? "Cells run without a network." : "Cells need the network on every run."}</small>
    </div>
  );
};

const Settings = () => {
  const { userSettings, options } = useContext(MystState);

  function changeSetting(id, enabled) {
    userSettings.value = userSettings.value.map((s) => (s.id == id ? { ...s, enabled } : s));
  }

  useSignalEffect(() => {
    localStorage.setItem("myst/settings", JSON.stringify(userSettings.value.map((s) => ({ id: s.id, enabled: s.enabled }))));
  });

  return (
    <SettingsList>
      <h1>Settings</h1>
      <ul>
        {userSettings.value.map((s) => (
          <li key={s.id}>
            <p>{s.title}</p>
            <Toggle name={s.id} id={s.id} checked={s.enabled} onChange={(ev) => changeSetting(s.id, ev.target.checked)} />
          </li>
        ))}
      </ul>
      <div className="settings-config">
        <button
          type="button"
          title="Open new file template"
          style = " margin-bottom: 0.5em;"
          onClick={async () => {
            try {
              const { path, created, editable } = await openNewFileTemplate(options.openFileInTab.value);
              if (created) showToast(`Created ${path} — it holds a simple default template, edit and reload.`, "success", 8000);
              else if (!editable) showToast("newFileTemplate.md is served with the application; this tab shows it read-only.", "success", 6000);
            } catch (err) {
              showToast(`Could not open the template file: ${err?.message ?? err}`, "error", 0);
            }
          }}
        >
          Open newFiletemplate.md
        </button>
        <button
          type="button"
          title="Open the configuration file of this installation"
          onClick={async () => {
            try {
              const { path, created, editable } = await openConfigFile();
              if (created) showToast(`Created ${path} — it holds the current defaults, edit and reload.`, "success", 8000);
              else if (!editable) showToast("config.json is served with the application; this tab shows it read-only.", "success", 6000);
            } catch (err) {
              showToast(`Could not open the configuration file: ${err?.message ?? err}`, "error", 0);
            }
          }}
        >
          Open config.json
        </button>
        <small>Settings above are per browser. config.json holds the rest, and applies at start-up.</small>
      </div>
      <OfflinePython />
    </SettingsList>
  );
};

export default Settings;
