import React from 'react'

// Minimal toast implementation to bypass initialization error
interface ToastProps {
  variant?: "default" | "destructive"
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

const ToastProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>
const ToastViewport = () => null
const Toast = ({ children, ...props }: ToastProps) => <>{children}</>
const ToastTitle = ({ children }: { children: React.ReactNode }) => <>{children}</>
const ToastDescription = ({ children }: { children: React.ReactNode }) => <>{children}</>
const ToastClose = () => null
const ToastAction = ({ children }: { children: React.ReactNode }) => <>{children}</>

export type ToastActionElement = React.ReactElement

export {
  type ToastProps,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}