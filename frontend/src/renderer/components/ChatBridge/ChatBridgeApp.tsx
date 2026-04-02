import { MantineProvider } from '@mantine/core'
import { AuthPage } from './AuthPage'
import { ChatWindow } from './ChatWindow'
import { useAuth } from './useAuth'

/**
 * ChatBridgeApp — root component for the ChatBridge web experience.
 * Handles auth gating: shows AuthPage until signed in, then ChatWindow.
 */
export function ChatBridgeApp() {
  const { session, loading, error, signIn, signUp, signOut } = useAuth()

  if (loading) {
    return (
      <MantineProvider>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: '#f8f9fa',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32 }}>🌉</div>
            <div style={{ marginTop: 8, color: '#868e96', fontSize: 14 }}>Loading ChatBridge...</div>
          </div>
        </div>
      </MantineProvider>
    )
  }

  return (
    <MantineProvider>
      {session ? (
        <ChatWindow
          userEmail={session.user?.email}
          onSignOut={signOut}
        />
      ) : (
        <AuthPage
          onSignIn={signIn}
          onSignUp={signUp}
          loading={loading}
          error={error}
        />
      )}
    </MantineProvider>
  )
}
