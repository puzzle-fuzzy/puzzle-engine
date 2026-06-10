import * as React from "react"
import { cn } from "@/lib/utils"

interface SelectProps extends React.ComponentProps<"select"> {
  options?: { label: string; value: string }[]
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, children, ...props }, ref) => {
    return (
      <select
        data-slot="select"
        className={cn(
          "flex h-8 w-full rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      >
        {options
          ? options.map(o => (
              <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
            ))
          : children}
      </select>
    )
  }
)
Select.displayName = "Select"

export { Select }
