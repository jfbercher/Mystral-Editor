// Petit utilitaire de notification Toast
//
// Un toast est "persistant" -- il attend un geste de l'utilisateur au lieu de
// s'effacer seul -- dans deux cas :
//   * `action` vaut { label, onClick } : un bouton est ajouté, et le faire
//     disparaître tout seul risquerait de le laisser passer inaperçu ;
//   * `duration` vaut 0 : pour un avertissement structurel, long à lire, dont
//     on veut être sûr qu'il a été vu.
// Dans les deux cas une croix de fermeture est ajoutée, et la touche Échap
// ferme le toast.  Avec une durée non nulle et sans action, le comportement
// d'origine est inchangé.
export function showToast(message, type = "success", duration = 2000, action = null) {
  // Supprime un éventuel toast déjà présent
  const existingToast = document.getElementById("app-toast");
  if (existingToast) existingToast.remove();

  const persistent = Boolean(action) || duration === 0;

  const toast = document.createElement("div");
  toast.id = "app-toast";
  if (persistent) {
    toast.setAttribute("role", "alert");
    toast.style.display = "flex";
    toast.style.alignItems = "flex-start";
    toast.style.gap = "12px";
    toast.style.maxWidth = "min(30rem, calc(100vw - 40px))";
    const label = document.createElement("span");
    label.textContent = message;
    label.style.flex = "1";
    toast.appendChild(label);
  } else {
    toast.textContent = message;
  }

  // Styles de base intégrés
  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    padding: "10px 18px",
    borderRadius: "6px",
    backgroundColor: type === "error" ? "#e74c3c" : "#ebe344",
    color: "#000000",
    fontWeight: "500",
    fontSize: "14px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: "9999",
    opacity: "0",
    transform: "translateY(10px)",
    transition: "all 0.25s ease-in-out",
  });

  // Registered below for persistent toasts; dismiss() unhooks it so a closed
  // toast never leaves a stray keydown listener behind.
  let onKey = null;
  const dismiss = () => {
    if (onKey) { document.removeEventListener("keydown", onKey); onKey = null; }
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 450);
  };

  if (persistent) {
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "\u2715";
    close.setAttribute("aria-label", "Dismiss");
    Object.assign(close.style, {
      border: "0", background: "transparent", font: "inherit", fontSize: "14px",
      lineHeight: "1.4", cursor: "pointer", color: "inherit", padding: "0 0 0 2px",
    });
    close.addEventListener("click", dismiss);

    // Échap ferme aussi : un toast persistant ne doit jamais rester coincé.
    onKey = (e) => { if (e.key === "Escape") dismiss(); };
    document.addEventListener("keydown", onKey);

    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      Object.assign(button.style, {
        padding: ".3rem .7rem", borderRadius: "4px", border: "1px solid rgba(0,0,0,.35)",
        background: "rgba(255,255,255,.75)", font: "inherit", fontSize: "13px",
        fontWeight: "600", cursor: "pointer", whiteSpace: "nowrap",
      });
      button.addEventListener("click", () => { dismiss(); action.onClick(); });
      toast.appendChild(button);
    }

    toast.appendChild(close);
  }

  document.body.appendChild(toast);

  // Animation d'entrée
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // Animation de sortie et suppression (sauf si le toast attend l'utilisateur)
  if (!persistent) setTimeout(dismiss, duration);
}

/**
 * Creates and manages the Update Progress Overlay
 */
export function createUpdateUI() {
  let modal = document.getElementById("update-modal");
  
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "update-modal";
    
    Object.assign(modal.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      backdropFilter: "blur(4px)",
      display: "none",
      justifyContent: "center",
      alignItems: "center",
      zIndex: "999999",
      fontFamily: "system-ui, -apple-system, sans-serif"
    });

    modal.innerHTML = `
      <div style="
        background: #ffffff;
        color: #1a1a1a;
        padding: 24px 28px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        width: 360px;
        max-width: 90vw;
        text-align: center;
      ">
        <h3 style="margin: 0 0 10px 0; font-size: 1.15rem; color: #111;">Updating Application</h3>
        <p id="update-progress-text" style="margin: 0 0 16px 0; font-size: 0.88rem; color: #555;">Preparing download...</p>
        <div style="width: 100%; background: #e0e0e0; border-radius: 8px; overflow: hidden; height: 10px;">
          <div id="update-progress-bar" style="width: 0%; height: 100%; background: #2563eb; transition: width 0.2s ease;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  const progressText = document.getElementById("update-progress-text");
  const progressBar = document.getElementById("update-progress-bar");

  return {
    show() {
      modal.style.display = "flex";
    },
    update(percent, text) {
      modal.style.display = "flex";
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText && text) progressText.innerText = text;
    },
    hide() {
      modal.style.display = "none";
    }
  };
}