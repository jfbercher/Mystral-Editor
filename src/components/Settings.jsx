import { useContext } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import { Compartment } from "@codemirror/state";
import { useSignalEffect } from "@preact/signals";
import { openConfigFile } from "../config";
import { showToast } from "../utils/utils_ui";

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

const Settings = () => {
  const { userSettings } = useContext(MystState);

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
    </SettingsList>
  );
};

export default Settings;
