import { useCallback, useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import "./NoteEditor.css";

const DEBOUNCE_MS = 400;

/**
 * Rich-text note editor backed by TipTap. The note is stored as HTML in the
 * item meta index (legacy plain-text notes load fine — they become a paragraph).
 *
 * `value` seeds the document; `onChange` fires (debounced) with the current
 * HTML. `docKey` identifies the underlying item — when it changes we reset the
 * editor to the new item's content rather than diffing keystrokes.
 */
export default function NoteEditor({
  docKey,
  value,
  onChange,
}: {
  docKey: string;
  value: string;
  onChange: (html: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest onChange without re-creating the editor on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const scheduleChange = useCallback((html: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      onChangeRef.current(html);
    }, DEBOUNCE_MS);
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: "Add a note…" }),
    ],
    content: value,
    onUpdate: ({ editor }) => scheduleChange(editor.getHTML()),
  });

  // When we switch to a different item, flush any pending debounce and load the
  // new content without emitting a spurious onChange.
  useEffect(() => {
    if (!editor) return;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    editor.commands.setContent(value || "", { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, editor]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="note-editor">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return; // cancelled
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  return (
    <div className="note-toolbar">
      <button
        type="button"
        className={editor.isActive("bold") ? "is-active" : ""}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
        aria-label="Bold"
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        className={editor.isActive("italic") ? "is-active" : ""}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
        aria-label="Italic"
      >
        <em>I</em>
      </button>
      <button
        type="button"
        className={editor.isActive("heading", { level: 2 }) ? "is-active" : ""}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading"
        aria-label="Heading"
      >
        H2
      </button>
      <span className="note-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className={editor.isActive("bulletList") ? "is-active" : ""}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
        aria-label="Bullet list"
      >
        •
      </button>
      <button
        type="button"
        className={editor.isActive("orderedList") ? "is-active" : ""}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Ordered list"
        aria-label="Ordered list"
      >
        1.
      </button>
      <span className="note-toolbar-sep" aria-hidden="true" />
      <button
        type="button"
        className={editor.isActive("link") ? "is-active" : ""}
        onClick={setLink}
        title="Link"
        aria-label="Link"
      >
        🔗
      </button>
    </div>
  );
}
