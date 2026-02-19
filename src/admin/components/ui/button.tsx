import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    asChild?: boolean
    variant?: "primary" | "secondary" | "outline" | "ghost"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = "primary", asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"

        const variants = {
            primary: "bg-black text-white hover:bg-zinc-800 shadow-[4px_4px_0px_0px_rgba(255,255,255,0.2)]",
            secondary: "bg-[#00E676] text-black hover:bg-[#00C853] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]",
            outline: "bg-white text-black border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-100",
            ghost: "bg-transparent border-transparent hover:bg-zinc-100 shadow-none"
        }

        return (
            <Comp
                className={cn(
                    "inline-flex items-center justify-center whitespace-nowrap text-sm font-black uppercase tracking-tight ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 px-6 py-3 border-4 border-black active:translate-x-1 active:translate-y-1 active:shadow-none",
                    variants[variant],
                    className
                )}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export { Button }
