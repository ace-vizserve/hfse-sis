"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:ring-1 group-[.toaster]:ring-inset group-[.toaster]:ring-hairline group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error:
            "group-[.toaster]:bg-destructive/5 group-[.toaster]:ring-destructive/30 group-[.toaster]:text-destructive",
          success:
            "group-[.toaster]:bg-brand-mint/20 group-[.toaster]:ring-brand-mint/60 group-[.toaster]:text-foreground",
          warning:
            "group-[.toaster]:bg-brand-amber-light group-[.toaster]:ring-brand-amber/50 group-[.toaster]:text-foreground",
          info:
            "group-[.toaster]:bg-accent group-[.toaster]:ring-brand-indigo-soft/40 group-[.toaster]:text-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
