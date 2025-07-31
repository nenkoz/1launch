import { toast as sonnerToast } from "sonner"

// Simple wrapper around Sonner toast for compatibility
interface ToastOptions {
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

function toast({ title, description, variant = "default" }: ToastOptions) {
  const message = title || description || ""
  
  if (variant === "destructive") {
    sonnerToast.error(message)
  } else {
    sonnerToast.success(message)
  }
  
  return {
    id: Math.random().toString(),
    dismiss: () => sonnerToast.dismiss(),
    update: () => {}
  }
}

function useToast() {
  return {
    toast,
    toasts: [],
    dismiss: () => sonnerToast.dismiss()
  }
}

export { useToast, toast }