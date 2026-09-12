// Petit utilitaire de notification Toast
export function showToast(message, type = "success", duration = 2000) {
  // Supprime un éventuel toast déjà présent
  const existingToast = document.getElementById("app-toast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "app-toast";
  toast.textContent = message;

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

  
  document.body.appendChild(toast);

  // Animation d'entrée
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // Animation de sortie et suppression
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 450);
  }, duration);
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