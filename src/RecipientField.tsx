import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { outlookApi, type Contact } from "./outlook";
export const validEmail = (value: string) =>
  /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
function split(value: string) {
  const all = value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
  return {
    chips: all.filter(validEmail),
    pending: all.filter((v) => !validEmail(v)).join(", "),
  };
}
export function RecipientField({
  label,
  value,
  onChange,
  disabled,
  required,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  required?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const initial = split(value),
    [chips, setChips] = useState(initial.chips),
    [pending, setPending] = useState(initial.pending),
    [suggestions, setSuggestions] = useState<Contact[]>([]),
    [active, setActive] = useState(0),
    [error, setError] = useState("");
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef || own;
  const emitted = useRef(value);
  useEffect(() => {
    if (label === "To" && !value) ref.current?.focus();
  }, []);
  useEffect(() => {
    if (value !== emitted.current) {
      const next = split(value);
      setChips(next.chips);
      setPending(next.pending);
      emitted.current = value;
    }
  }, [value]);
  useEffect(() => {
    let live = true;
    if (pending.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(
      () =>
        void outlookApi
          .contacts(pending)
          .then((next) => {
            if (live) {
              setSuggestions(next);
              setActive(0);
            }
          })
          .catch(() => {}),
      200,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pending]);
  const emit = (next: string[], text: string) => {
    const result = [...next, ...(text.trim() ? [text] : [])].join(", ");
    emitted.current = result;
    onChange(result);
  };
  const commit = (raw = pending) => {
    const values = raw
      .split(/[,;]/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.some((v) => !validEmail(v))) {
      setError("Enter complete email addresses.");
      return false;
    }
    const next = [...chips];
    for (const address of values)
      if (!next.some((v) => v.toLowerCase() === address.toLowerCase()))
        next.push(address);
    setChips(next);
    setPending("");
    setError("");
    setSuggestions([]);
    emit(next, "");
    return true;
  };
  return (
    <div className="recipient-editor">
      <div
        className="recipient-chips"
        role="list"
        aria-label={`${label} recipients`}
      >
        {chips.map((address, index) => (
          <span className="recipient-chip" role="listitem" key={address}>
            <button
              type="button"
              disabled={disabled}
              title="Edit address"
              onClick={() => {
                const next = chips.filter((_, i) => i !== index);
                setChips(next);
                setPending(address);
                emit(next, address);
                ref.current?.focus();
              }}
            >
              {address}
            </button>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Remove recipient ${address}`}
              onClick={() => {
                const next = chips.filter((_, i) => i !== index);
                setChips(next);
                emit(next, pending);
                ref.current?.focus();
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={ref}
          aria-label={label}
          required={required && !chips.length}
          value={pending}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          placeholder={
            chips.length ? "Add recipient…" : "Name or email address"
          }
          aria-invalid={!!error}
          onChange={(event) => {
            setPending(event.target.value);
            setError("");
            emit(chips, event.target.value);
          }}
          onBlur={() => {
            if (pending.trim()) commit();
          }}
          onKeyDown={(event) => {
            if (
              suggestions.length &&
              (event.key === "ArrowDown" || event.key === "ArrowUp")
            ) {
              event.preventDefault();
              setActive(
                (index) =>
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    suggestions.length) %
                  suggestions.length,
              );
              return;
            }
            if (event.key === "Escape") {
              setSuggestions([]);
              return;
            }
            if (event.key === "Enter" && suggestions[active]?.address) {
              event.preventDefault();
              commit(suggestions[active].address!);
              return;
            }
            if (["Enter", ",", ";"].includes(event.key)) {
              event.preventDefault();
              commit();
            } else if (event.key === "Tab" && pending.trim()) commit();
            else if (event.key === "Backspace" && !pending && chips.length) {
              const next = chips.slice(0, -1);
              const address = chips[chips.length - 1];
              setChips(next);
              setPending(address);
              emit(next, address);
            }
          }}
        />
      </div>
      {error && (
        <span className="recipient-error" role="alert">
          {error}
        </span>
      )}
      {!!suggestions.length && (
        <div
          className="recipient-suggestions"
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {suggestions.map((contact, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === active}
              key={contact.address}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                commit(contact.address!);
                ref.current?.focus();
              }}
            >
              <strong>{contact.name || contact.address}</strong>
              <span>{contact.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
