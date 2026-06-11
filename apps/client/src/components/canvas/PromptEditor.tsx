import type { CharacterDTO, LocationDTO } from '@excuse/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

interface PromptEditorProps {
  value: string
  onChange: (value: string) => void
  characters: CharacterDTO[]
  locations: LocationDTO[]
  placeholder?: string
  rows?: number
  disabled?: boolean
}

interface MentionItem {
  type: 'character' | 'location'
  id: string
  name: string
}

export function PromptEditor({
  value,
  onChange,
  characters,
  locations,
  placeholder = '输入提示词，@ 插入角色或场景引用...',
  rows = 4,
  disabled = false,
}: PromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(-1)

  const mentionItems: MentionItem[] = [
    ...characters.map(c => ({ type: 'character' as const, id: c.id, name: c.name })),
    ...locations.map(l => ({ type: 'location' as const, id: l.id, name: l.name })),
  ]

  const filteredItems = mentionItems.filter(item =>
    item.name.toLowerCase().includes(mentionFilter.toLowerCase()),
  )

  const insertMention = useCallback((item: MentionItem) => {
    const textarea = textareaRef.current
    if (!textarea)
      return

    const before = value.slice(0, mentionStart)
    const after = value.slice(textarea.selectionStart)
    const tag = `[${item.type === 'character' ? 'Character' : 'Location'}:${item.name}]`
    const newValue = `${before}${tag}${after}`

    onChange(newValue)
    setShowMentions(false)
    setMentionFilter('')

    requestAnimationFrame(() => {
      const cursorPos = before.length + tag.length
      textarea.focus()
      textarea.setSelectionRange(cursorPos, cursorPos)
    })
  }, [value, mentionStart, onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showMentions)
      return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex(prev => Math.max(prev - 1, 0))
    }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const item = filteredItems[mentionIndex]
      if (item)
        insertMention(item)
    }
    else if (e.key === 'Escape') {
      setShowMentions(false)
    }
  }, [showMentions, filteredItems, mentionIndex, insertMention])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart
    onChange(newValue)

    // Detect @ trigger
    const textBeforeCursor = newValue.slice(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1)
      // Only show mentions if @ is at start of line, after space, or after [
      if (atIndex === 0 || /[\s[]$/.test(newValue[atIndex - 1])) {
        // Close if there's a space after @
        if (textAfterAt.includes(' ') || textAfterAt.includes('\n')) {
          setShowMentions(false)
          return
        }
        setShowMentions(true)
        setMentionFilter(textAfterAt)
        setMentionStart(atIndex)
        setMentionIndex(0)
      }
      else {
        setShowMentions(false)
      }
    }
    else {
      setShowMentions(false)
    }
  }, [onChange])

  useEffect(() => {
    setMentionIndex(0)
  }, [filteredItems.length])

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(setShowMentions, 150, false)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className="w-full rounded-lg border px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />

      {showMentions && filteredItems.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border bg-white shadow-lg">
          {filteredItems.map((item, i) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-100 ${i === mentionIndex ? 'bg-gray-100' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(item)
              }}
            >
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${item.type === 'character' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-700'}`}>
                {item.type === 'character' ? '角色' : '场景'}
              </span>
              <span>{item.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
