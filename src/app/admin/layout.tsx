export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ad-bg text-ad-text antialiased">
      {children}
    </div>
  )
}
