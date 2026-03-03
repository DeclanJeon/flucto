import { type ChangeEvent, useEffect, useState } from 'react'

interface PostEditorProps {
  initialContent?: string;
  onSave?: (html: string, json: Record<string, unknown>) => void;
}

export const PostEditor = ({ initialContent, onSave }: PostEditorProps) => {
  const [content, setContent] = useState<string>(initialContent || '')

  const normalizedContent = content || ''

  useEffect(() => {
    const html = normalizedContent
    const json: Record<string, unknown> = {
      type: 'doc',
      content: normalizedContent
        ? [{ type: 'paragraph', content: [{ type: 'text', text: normalizedContent }] }]
        : []
    }
    onSave?.(html, json)
  }, [normalizedContent, onSave])

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setContent(event.target.value)
  }

  return (
    <div className="flex flex-col gap-4">
      <textarea
        aria-label="post-content-editor"
        value={content}
        onChange={handleChange}
        className="min-h-[400px] w-full rounded border border-white/10 bg-white/5 p-4 text-sm leading-6 focus:outline-none"
      />
    </div>
  );
};
