import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, Link } from '@tiptap/extension-bold'
import { Star } from 'lucide-react'

interface PostEditorProps {
  initialContent?: string;
  onSave?: (html: string, json: any) => void;
  placeholder?: string;
}

export const PostEditor = ({ initialContent, onSave, placeholder = 'Start writing your post...' }: PostEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Bold,
      Italic,
      List.configure({
        HTMLAttributes: { class: 'list-disc' }
      }),
      Link.configure({
        openOnClick: false
      })
    ],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class: 'prose prose max-w-none focus:outline-none min-h-[400px] px-4'
      }
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const json = editor.getJSON();
      onSave?.(html, json);
    }
  });

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Simple Toolbar */}
      <div className="border-b p-2 flex gap-2">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'bg-blue-500 text-white px-3 py-1 rounded' : 'bg-gray-700 text-white px-3 py-1 rounded'}
        >
          Bold
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'bg-blue-500 text-white px-3 py-1 rounded' : 'bg-gray-700 text-white px-3 py-1 rounded'}
        >
          Italic
        </button>
      </div>

      {/* Editor Content */}
      <EditorContent editor={editor} />
    </div>
  );
};
