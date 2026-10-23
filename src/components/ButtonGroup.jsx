import { useEffect, useRef, useState } from "preact/hooks";
import styled from "styled-components";
import { DefaultButton } from "./CommonUI";
import { useComputed } from "@preact/signals";

const GroupContainer = styled.div`
  display: flex;

  & > button:first-child {
    border-left: 1px solid var(--border) !important;
    border-radius: var(--border-radius) 0 0 var(--border-radius);
  }

  /* Opened by a click and closed deliberately, not by the pointer wandering.
     The hover version was unusable: the strip that bridges the button and the
     menu is only as wide as the button, so a diagonal move towards an entry
     crossed a dead zone and the menu vanished mid-reach. A menu that has to be
     caught is not a menu. */
  .btn-dropdown {
    left: auto;
    right: 0;
    display: none !important;
  }

  .btn-dropdown.open {
    display: block !important;
  }

  .dropdown-btns {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const RadioButton = styled(DefaultButton)`
  background-color: ${(props) => (props.active ? "var(--accent)" : "var(--button-bg)")};
  width: 40px;
  border: "1px solid var(--border)";
  border-left: none;
  border-radius: 0;

  &:hover:not(&:disabled) {
    background-color: var(--accent-light);
  }

  &.more {
    border-radius: 0 var(--border-radius) var(--border-radius) 0;
  }
`;

const DropdownButton = styled(DefaultButton)`
  gap: 8px;
  width: 100%;
  padding: 0 16px;
  justify-content: start;
  background-color: ${(props) => (props.active ? "var(--accent) !important" : "var(--button-bg)")};
`;

const MoreIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
    <path d="M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z" />
  </svg>
);

const ButtonGroup = ({ buttons, clickedId, mainButtonsNum = buttons.value.length }) => {
  useEffect(() => {
    buttons.value[clickedId].action();
  }, []);

  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);

  // Opened by the pointer, like the other menus of the topbar, but opened and
  // closed by *this* component rather than by `:hover` in a stylesheet. The
  // CSS version was unusable, and for a reason no amount of tuning would have
  // fixed: the box it hung on was twenty pixels wide while the menu drawn out
  // of it was a hundred and fifty, so a diagonal move towards an entry left
  // the hover region and the menu vanished mid-reach.
  //
  // Here the whole group is the region, and leaving it is forgiven for a
  // moment -- long enough to cross a gap or clip a corner, short enough that a
  // menu one has walked away from does not linger.
  const enter = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Escape closes it, and so does a press elsewhere -- a pointer that never
  // left the group, because the window lost focus or a click landed on the
  // editor, would otherwise leave it hanging. The guard asks the event's own
  // target rather than a ref on the container: the container is a styled
  // component, and a ref that does not reach the DOM node would make every
  // press look like an outside press.
  //
  // Bubble phase, not capture: an entry's own handler must run first. A
  // capturing listener here closed the menu before the press reached the
  // entry, and the entry was never told it had been chosen.
  useEffect(() => {
    if (!open) return;
    const onDown = (ev) => {
      const t = ev.target;
      if (t instanceof Element && t.closest(".btn-dropdown, .radio-icon.more")) return;
      setOpen(false);
    };
    const onKey = (ev) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Choosing an entry, on the press rather than on the click.
   *
   * A synthetic `click` only happens when press and release land on the *same*
   * element, and an entry of this menu is not a stable element: hovering one
   * recomputes the whole list of buttons -- the Diff entry asks, as it is
   * hovered, whether there is anything to compare -- and the node under the
   * pointer can be replaced between the two halves of the gesture. The click
   * then never fires, and the entry looks dead. Acting on the press removes
   * the whole class of failure, and is what a native menu does anyway.
   */
  const choose = (button) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setOpen(false);
    button.action();
  };

  const mainButtons = useComputed(() => buttons.value.slice(0, mainButtonsNum));
  const dropdownButtons = useComputed(() => buttons.value.slice(mainButtonsNum));

  return (
    <GroupContainer>
      {mainButtons.value.map((button, i) => (
        <RadioButton
          className="icon radio-icon"
          type="button"
          disabled={button.disabled}
          key={button.id}
          name={button.id}
          onClick={() => button.action()}
          onMouseOver={() => button.hover?.()}
          title={button.tooltip}
          active={i === clickedId}
        >
          {typeof button.icon == "function" ? <button.icon /> : <img src={button.icon} />}
        </RadioButton>
      ))}
      <div onMouseEnter={enter} onMouseLeave={leave} onFocusIn={enter}>
        <RadioButton
          className="icon radio-icon more"
          type="button"
          title="More views"
          aria-expanded={open}
          active={clickedId >= mainButtonsNum}
        >
          <MoreIcon />
        </RadioButton>
        <div className={open ? "btn-dropdown open" : "btn-dropdown"}>
          <div className="dropdown-content">
            <div className="dropdown-btns">
              {dropdownButtons.value.map((button, i) => (
                <DropdownButton
                  type="button"
                  disabled={button.disabled}
                  key={button.id}
                  name={button.id}
                  onMouseDown={choose(button)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") choose(button)(ev);
                  }}
                  onMouseOver={() => button.hover?.()}
                  title={button.tooltip}
                  active={i + mainButtonsNum === clickedId}
                >
                  {typeof button.icon == "function" ? <button.icon /> : <img src={button.icon} />}
                  <span>{button.text}</span>
                </DropdownButton>
              ))}
            </div>
          </div>
        </div>
      </div>
    </GroupContainer>
  );
};

export default ButtonGroup;
