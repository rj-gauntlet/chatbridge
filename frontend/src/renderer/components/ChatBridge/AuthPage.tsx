import {
  Anchor,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useState } from 'react'

interface AuthPageProps {
  onSignIn: (email: string, password: string) => Promise<void>
  onSignUp: (email: string, password: string) => Promise<string | undefined>
  loading: boolean
  error: string | null
}

export function AuthPage({ onSignIn, onSignUp, loading, error }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    try {
      if (mode === 'login') {
        await onSignIn(email, password)
      } else {
        const msg = await onSignUp(email, password)
        if (msg) setMessage(msg)
      }
    } catch {
      // error shown via prop
    }
  }

  return (
    <Center h="100vh" bg="var(--mantine-color-gray-0)">
      <Paper shadow="md" radius="md" p="xl" w={400}>
        <Stack gap="md">
          <Box ta="center">
            <Title order={2} fw={700}>
              🌉 ChatBridge
            </Title>
            <Text c="dimmed" size="sm" mt={4}>
              {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
            </Text>
          </Box>

          <Divider />

          <form onSubmit={handleSubmit}>
            <Stack gap="sm">
              <TextInput
                label="Email"
                placeholder="you@example.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
              <PasswordInput
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={6}
              />

              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              {message && (
                <Text c="green" size="sm">
                  {message}
                </Text>
              )}

              <Button type="submit" loading={loading} fullWidth mt="xs">
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </Button>
            </Stack>
          </form>

          <Group justify="center" mt="xs">
            <Text size="sm" c="dimmed">
              {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
            </Text>
            <Anchor
              size="sm"
              c="blue"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setMessage(null)
              }}
            >
              {mode === 'login' ? 'Register' : 'Sign In'}
            </Anchor>
          </Group>
        </Stack>
      </Paper>
    </Center>
  )
}
