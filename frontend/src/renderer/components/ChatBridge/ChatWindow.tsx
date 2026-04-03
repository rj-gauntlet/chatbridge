import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Title,
} from '@mantine/core'
import { IconSend, IconTrash } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { streamChat, listConversations, getConversation, deleteConversation, listApps, type Conversation, type AppRegistration } from '../../services/chatbridgeApi'
import { PluginFrame, usePluginManager } from './PluginManager'

const API_URL = (import.meta.env.VITE_API_URL as string) || 'http://localhost:3001'
const SESSION_KEY = 'chatbridge_session'

function getToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw).access_token || null
  } catch { return null }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  appSlug?: string // set when message triggered an app
}

interface ChatWindowProps {
  userEmail?: string
  onSignOut: () => void
}

export function ChatWindow({ userEmail, onSignOut }: ChatWindowProps) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConvId, setActiveConvId] = useState<string | undefined>()
  const [messages, setMessages] = useState<Message[]>([])
  const [apps, setApps] = useState<AppRegistration[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loadingConvs, setLoadingConvs] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { activePlugin, iframeRef, openApp, closeApp, handleToolCallEvent, onCompletion, onIframeLoad } =
    usePluginManager(API_URL, getToken)

  // Load conversations + apps on mount
  useEffect(() => {
    listConversations().then(setConversations).catch(console.error).finally(() => setLoadingConvs(false))
    listApps().then(setApps).catch(console.error)
  }, [])

  // When app completes, add a system message to chat
  useEffect(() => {
    return onCompletion((summary) => {
      setMessages(prev => [...prev, {
        id: `completion-${Date.now()}`,
        role: 'assistant',
        content: `✅ ${summary}`,
      }])
    })
  }, [onCompletion])

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingContent])

  const loadConversation = useCallback(async (id: string) => {
    const conv = await getConversation(id)
    setActiveConvId(id)
    setMessages(
      conv.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content }))
    )
  }, [])

  const startNewConversation = useCallback(() => {
    setActiveConvId(undefined)
    setMessages([])
    setInput('')
    closeApp()
  }, [closeApp])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message = { id: `temp-${Date.now()}`, role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setStreamingContent('')

    let assistantContent = ''

    try {
      for await (const event of streamChat(text, activeConvId)) {
        if (event.type === 'start') {
          setActiveConvId(event.conversationId)
        } else if (event.type === 'intent_classified') {
          // App was identified — open it if not already open
          const slug = (event as { type: string; appSlug: string }).appSlug
          const appReg = apps.find(a => a.slug === slug)
          if (appReg && (!activePlugin || activePlugin.appSlug !== slug)) {
            openApp(slug, appReg.iframe_url)
          }
        } else if (event.type === 'tool_call') {
          // Relay tool invocation to iframe
          const e = event as { type: string; appSlug: string; toolName: string; correlationId: string; parameters?: Record<string, unknown> }
          await handleToolCallEvent(e.appSlug, e.toolName, e.correlationId, e.parameters || {})
        } else if (event.type === 'delta') {
          assistantContent += event.content
          setStreamingContent(assistantContent)
        } else if (event.type === 'done') {
          setMessages(prev => [
            ...prev,
            { id: event.messageId || `ai-${Date.now()}`, role: 'assistant', content: assistantContent },
          ])
          setStreamingContent('')
          listConversations().then(setConversations).catch(console.error)
        } else if (event.type === 'error') {
          setMessages(prev => [
            ...prev,
            { id: `err-${Date.now()}`, role: 'assistant', content: `⚠️ ${event.message}` },
          ])
          setStreamingContent('')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection error'
      setMessages(prev => [
        ...prev,
        { id: `err-${Date.now()}`, role: 'assistant', content: `⚠️ ${msg}` },
      ])
      setStreamingContent('')
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, activeConvId, apps, activePlugin, openApp, handleToolCallEvent])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const handleDeleteConv = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteConversation(id)
    setConversations(prev => prev.filter(c => c.id !== id))
    if (activeConvId === id) startNewConversation()
  }

  return (
    <Flex h="100vh" bg="var(--mantine-color-gray-0)">
      {/* Sidebar */}
      <Box w={260} bg="white" style={{ borderRight: '1px solid var(--mantine-color-gray-2)', display: 'flex', flexDirection: 'column' }}>
        <Box p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
          <Title order={4}>🌉 ChatBridge</Title>
          <Text size="xs" c="dimmed" truncate>{userEmail}</Text>
        </Box>

        <Box p="sm">
          <Button fullWidth size="sm" variant="light" onClick={startNewConversation}>+ New Chat</Button>
        </Box>

        {/* Available apps */}
        {apps.length > 0 && (
          <Box px="sm" pb="xs">
            <Text size="xs" c="dimmed" fw={500} mb={6}>APPS</Text>
            <Group gap={4} wrap="wrap">
              {apps.map(app => (
                <Badge
                  key={app.slug}
                  size="sm"
                  variant={activePlugin?.appSlug === app.slug ? 'filled' : 'light'}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openApp(app.slug, app.iframe_url)}
                >
                  {app.icon_url || '📦'} {app.name}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        <ScrollArea flex={1} p="xs">
          {loadingConvs ? (
            <Loader size="sm" m="auto" mt="md" />
          ) : conversations.length === 0 ? (
            <Text c="dimmed" size="xs" ta="center" mt="md">No conversations yet</Text>
          ) : (
            <Stack gap={4}>
              {conversations.map(conv => (
                <Group
                  key={conv.id}
                  px="sm"
                  py={8}
                  onClick={() => loadConversation(conv.id)}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 6,
                    background: activeConvId === conv.id ? 'var(--mantine-color-blue-0)' : 'transparent',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text size="sm" truncate style={{ flex: 1, maxWidth: 170 }}>{conv.title}</Text>
                  <ActionIcon size="xs" variant="subtle" color="red" onClick={(e) => handleDeleteConv(conv.id, e)}>
                    <IconTrash size={12} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </ScrollArea>

        <Box p="md" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
          <Button variant="subtle" size="xs" fullWidth onClick={onSignOut} color="gray">Sign Out</Button>
        </Box>
      </Box>

      {/* Main area: chat left + plugin panel right */}
      <Flex flex={1} direction="row" style={{ minWidth: 0, overflow: 'hidden' }}>

        {/* Chat column */}
        <Flex flex={1} direction="column" style={{ minWidth: 0 }}>
          {/* Messages */}
          <ScrollArea flex={1} p="md" viewportRef={scrollRef}>
            {messages.length === 0 && !streaming ? (
              <Box ta="center" mt="20vh">
                <Text size="xl">👋</Text>
                <Text size="lg" fw={500} mt="sm">What can I help you with?</Text>
                <Text c="dimmed" size="sm" mt={4}>Try: "Let's play chess", "Quiz me on history", "Open the drawing canvas", or "Play some music on Spotify"</Text>
              </Box>
            ) : (
              <Stack gap="md" pb="xl">
                {messages.map(msg => (
                  <Flex key={msg.id} justify={msg.role === 'user' ? 'flex-end' : 'flex-start'} gap="sm">
                    {msg.role === 'assistant' && <Avatar size="sm" color="blue" radius="xl">AI</Avatar>}
                    <Paper
                      p="sm"
                      radius="md"
                      maw="75%"
                      bg={msg.role === 'user' ? 'blue' : 'white'}
                      style={{ border: msg.role === 'assistant' ? '1px solid var(--mantine-color-gray-2)' : 'none' }}
                    >
                      <Text size="sm" c={msg.role === 'user' ? 'white' : 'inherit'} style={{ whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </Text>
                    </Paper>
                    {msg.role === 'user' && <Avatar size="sm" color="gray" radius="xl">You</Avatar>}
                  </Flex>
                ))}

                {(streaming || streamingContent) && (
                  <Flex justify="flex-start" gap="sm">
                    <Avatar size="sm" color="blue" radius="xl">AI</Avatar>
                    <Paper p="sm" radius="md" maw="75%" bg="white" style={{ border: '1px solid var(--mantine-color-gray-2)' }}>
                      {streamingContent ? (
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{streamingContent}</Text>
                      ) : (
                        <Loader size="xs" type="dots" />
                      )}
                    </Paper>
                  </Flex>
                )}
              </Stack>
            )}
          </ScrollArea>

          {/* Input */}
          <Box p="md" bg="white" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
            <Group gap="sm" align="flex-end">
              <Textarea
                flex={1}
                placeholder="Try: Let's play chess! (Enter to send)"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                autosize
                minRows={1}
                maxRows={6}
                disabled={streaming}
                styles={{ input: { resize: 'none' } }}
              />
              <ActionIcon size="lg" variant="filled" onClick={sendMessage} loading={streaming} disabled={!input.trim()}>
                <IconSend size={16} />
              </ActionIcon>
            </Group>
          </Box>
        </Flex>

        {/* Plugin panel (right side, full height) */}
        {activePlugin && (
          <Box
            w={420}
            style={{
              borderLeft: '1px solid var(--mantine-color-gray-2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <PluginFrame plugin={activePlugin} iframeRef={iframeRef} onClose={closeApp} onLoad={onIframeLoad} />
          </Box>
        )}

      </Flex>
    </Flex>
  )
}
