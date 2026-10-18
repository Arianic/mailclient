import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// Keep the popup inside the app document: GTK's native select popup can use a
// different theme from the WebView, including when the app overrides the system.
export function ThemedSelect({
  value,
  onValueChange,
  children,
  "aria-label": label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  "aria-label": string;
}) {
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children: ReactNode }>(child))
      return [];
    const text = Children.toArray(child.props.children).join("");
    return [{ value: child.props.value ?? text, text }];
  });
  const selected = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const id = useId();
  const show = (index = Math.max(0, selected)) => {
    search.current = { text: "", time: 0 };
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number) => {
    if (!options[index]) return;
    onValueChange(options[index].value);
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) {
      setPosition(null);
      return;
    }
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 14;
    const above = rect.top - 14;
    const upwards =
      below < Math.min(280, options.length * 36 + 12) && above > below;
    const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(upwards
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
      width,
      maxHeight: Math.max(40, Math.min(320, upwards ? above : below)),
    });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    if (open && position)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, position, id]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open ? choose(active) : show();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else
        setActive(
          (index) =>
            (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
            options.length,
        );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      show(event.key === "Home" ? 0 : options.length - 1);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      const now = Date.now();
      const text =
        (now - search.current.time < 700 ? search.current.text : "") +
        event.key.toLocaleLowerCase();
      search.current = { text, time: now };
      // Repeated letters cycle through matching choices.
      const query = [...text].every((letter) => letter === text[0])
        ? text[0]
        : text;
      const start = open ? active : selected;
      const match = options
        .map(
          (_, offset) =>
            (Math.max(0, start) + offset + (query.length === 1 ? 1 : 0)) %
            options.length,
        )
        .find((index) =>
          options[index].text.toLocaleLowerCase().startsWith(query),
        );
      if (match !== undefined) {
        setActive(match);
        setOpen(true);
      }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="select-control"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="select-label">
          {options[selected]?.text ?? "Choose…"}
        </span>
        <ChevronDown className="select-chevron" size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            className="select-popover"
            role="listbox"
            aria-label={label}
            style={{ ...position, visibility: position ? "visible" : "hidden" }}
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === selected}
                className={`select-option ${index === active ? "is-active" : ""}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>{option.text}</span>
                {index === selected && <Check size={14} aria-hidden="true" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
