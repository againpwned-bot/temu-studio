/** Wires a <button role="switch"> to a boolean value. */
export function bindSwitch(button, { checked = false, onChange = () => {} } = {}) {
  const set = (value, emit) => {
    button.setAttribute('aria-checked', String(value));
    if (emit) onChange(value);
  };
  set(checked, false);
  button.addEventListener('click', () => {
    if (button.disabled) return;
    set(button.getAttribute('aria-checked') !== 'true', true);
  });
  return {
    get checked() {
      return button.getAttribute('aria-checked') === 'true';
    },
    set: (value) => set(value, false),
  };
}
