import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Link,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "lucide-react";
import { cleanWritingHtml, validWritingLink } from "./writing";
import { ThemedSelect } from "./ThemedSelect";
export type RichEditorHandle = { insertHtml: (html: string) => void };
export const RichTextEditor = forwardRef<
  RichEditorHandle,
  {
    value: string;
    onChange: (html: string, text: string) => void;
    disabled?: boolean;
    label?: string;
    compact?: boolean;
  }
>(
  (
    {
      value,
      onChange,
      disabled = false,
      label = "Message body",
      compact = false,
    },
    ref,
  ) => {
    const change = useRef(onChange);
    change.current = onChange;
    const [linkOpen, setLinkOpen] = useState(false),
      [url, setUrl] = useState(""),
      [linkError, setLinkError] = useState("");
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: false,
            linkOnPaste: false,
            HTMLAttributes: { target: null, rel: null },
            isAllowedUri: validWritingLink,
          },
        }),
      ],
      content: cleanWritingHtml(value),
      editable: !disabled,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-label": label,
          "aria-multiline": "true",
          "data-placeholder": "Write your message…",
        },
        transformPastedHTML: cleanWritingHtml,
        handleDOMEvents: {
          drop: (_view, event) => !!event.dataTransfer?.files.length,
        },
        handleClick: (_view, _pos, event) => {
          if ((event.target as Element)?.closest("a")) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) =>
        change.current(
          cleanWritingHtml(editor.getHTML()),
          editor.getText({ blockSeparator: "\n" }),
        ),
    });
    useEffect(() => {
      if (
        editor &&
        cleanWritingHtml(editor.getHTML()) !== cleanWritingHtml(value)
      )
        editor.commands.setContent(cleanWritingHtml(value), {
          emitUpdate: false,
        });
    }, [editor, value]);
    useEffect(() => {
      editor?.setEditable(!disabled, false);
    }, [editor, disabled]);
    useImperativeHandle(
      ref,
      () => ({
        insertHtml: (html) => {
          if (!disabled)
            editor?.chain().focus().insertContent(cleanWritingHtml(html)).run();
        },
      }),
      [editor, disabled],
    );
    if (!editor) return null;
    const commands = [
      {
        name: "Bold",
        icon: Bold,
        active: editor.isActive("bold"),
        run: () => editor.chain().focus().toggleBold().run(),
      },
      {
        name: "Italic",
        icon: Italic,
        active: editor.isActive("italic"),
        run: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        name: "Underline",
        icon: Underline,
        active: editor.isActive("underline"),
        run: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        name: "Strikethrough",
        icon: Strikethrough,
        active: editor.isActive("strike"),
        run: () => editor.chain().focus().toggleStrike().run(),
      },
      {
        name: "Bullet list",
        icon: List,
        active: editor.isActive("bulletList"),
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        name: "Numbered list",
        icon: ListOrdered,
        active: editor.isActive("orderedList"),
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        name: "Quote",
        icon: Quote,
        active: editor.isActive("blockquote"),
        run: () => editor.chain().focus().toggleBlockquote().run(),
      },
      {
        name: "Clear formatting",
        icon: RemoveFormatting,
        run: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
      },
    ];
    return (
      <div className={`rich-editor${compact ? " rich-editor-compact" : ""}`}>
        <div
          className="rich-toolbar"
          role="group"
          aria-label={`${label} formatting`}
        >
          <ThemedSelect
            aria-label={`${label} text style`}
            value={
              editor.isActive("heading", { level: 1 })
                ? "h1"
                : editor.isActive("heading", { level: 2 })
                  ? "h2"
                  : "paragraph"
            }
            onValueChange={(value) => {
              if (value === "paragraph")
                editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: value === "h1" ? 1 : 2 })
                  .run();
            }}
            disabled={disabled}
          >
            <option value="paragraph">Normal text</option>
            <option value="h1">Heading</option>
            <option value="h2">Small heading</option>
          </ThemedSelect>
          {commands.map(({ name, icon: Icon, active, run }) => (
            <button
              key={name}
              type="button"
              className="icon-button"
              title={name}
              aria-label={name}
              aria-pressed={active}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={run}
            >
              <Icon size={14} />
            </button>
          ))}
          <button
            type="button"
            className="icon-button"
            aria-label="Insert or edit link"
            title="Insert or edit link"
            aria-pressed={editor.isActive("link")}
            disabled={disabled}
            onClick={() => {
              setUrl(editor.getAttributes("link").href || "");
              setLinkError("");
              setLinkOpen(!linkOpen);
            }}
          >
            <Link size={14} />
          </button>
          <span className="grow" />
          <button
            type="button"
            className="icon-button"
            aria-label="Undo typing"
            title="Undo · Ctrl Z"
            disabled={disabled || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Redo typing"
            title="Redo · Ctrl Shift Z"
            disabled={disabled || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={14} />
          </button>
        </div>
        {linkOpen && (
          <div className="writing-link-panel">
            <label>
              Link address
              <input
                autoFocus
                aria-label="Link address"
                value={url}
                disabled={disabled}
                placeholder="https://example.com"
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setLinkOpen(false);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="soft-button"
              disabled={disabled}
              onClick={() => {
                if (!validWritingLink(url.trim())) {
                  setLinkError("Use an http, https or mailto address.");
                  return;
                }
                const range = editor.state.selection;
                const chain = editor.chain().focus();
                if (range.empty && !editor.isActive("link"))
                  chain
                    .insertContent({
                      type: "text",
                      text: url.trim(),
                      marks: [{ type: "link", attrs: { href: url.trim() } }],
                    })
                    .run();
                else
                  chain
                    .extendMarkRange("link")
                    .setLink({ href: url.trim() })
                    .run();
                setLinkOpen(false);
              }}
            >
              Apply link
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkOpen(false);
              }}
            >
              Remove link
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setLinkOpen(false)}
            >
              Cancel
            </button>
            {linkError && <span role="alert">{linkError}</span>}
          </div>
        )}
        <EditorContent editor={editor} />
      </div>
    );
  },
);
