import { useEffect, useRef, useState } from "react";

export interface PromptState {
  title: string;
  initial: string;
  confirmLabel: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
}

export default function PromptModal({
  state,
  onClose,
}: {
  state: PromptState;
  onClose: () => void;
}) {
  const [value, setValue] = useState(state.initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    state.onConfirm(value);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{state.title}</h3>
        <input
          ref={inputRef}
          value={value}
          placeholder={state.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={submit}>
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
