"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  text: string;
  /** Rótulo acessível do botão (padrão: Ajuda). */
  label?: string;
};

export function HelpTip({ text, label = "Ajuda" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popupId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        type="button"
        className="help-tip-btn"
        aria-label={label}
        aria-expanded={open}
        aria-controls={popupId}
        onClick={() => setOpen((v) => !v)}
      >
        (?)
      </button>
      {open && (
        <span id={popupId} role="tooltip" className="help-tip-popup">
          {text}
        </span>
      )}
    </span>
  );
}

export function FieldLabel({
  children,
  help,
}: {
  children: React.ReactNode;
  help?: string;
}) {
  return (
    <span className="field-label-row">
      <span>{children}</span>
      {help ? <HelpTip text={help} label={`Ajuda: ${String(children)}`} /> : null}
    </span>
  );
}
