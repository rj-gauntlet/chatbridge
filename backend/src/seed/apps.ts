import 'dotenv/config'
import { supabaseAdmin } from '../services/supabase'

/**
 * Seeds the app_registrations table with the four built-in ChatBridge apps.
 * Run with: npx tsx src/seed/apps.ts
 */

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const APPS_BASE = `${FRONTEND_URL}/apps`

const apps = [
  {
    name: 'Chess',
    slug: 'chess',
    description: 'Interactive chess game. User can play chess, ask for move suggestions, analyze positions, and review game history. Use when user mentions chess, wants to play a game, or asks about chess moves.',
    icon_url: '♟️',
    iframe_url: `${APPS_BASE}/chess/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'start_game',
        description: 'Start a new chess game. Resets the board to the initial position.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Optional opening message to display' },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            fen: { type: 'string', description: 'Initial board position in FEN notation' },
            turn: { type: 'string', description: 'Whose turn it is: w or b' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make a chess move using algebraic notation (e.g. e2 to e4). Validates the move and updates the board.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source square (e.g. "e2")' },
            to: { type: 'string', description: 'Target square (e.g. "e4")' },
            promotion: { type: 'string', description: 'Promotion piece (q/r/b/n), default q' },
          },
          required: ['from', 'to'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            move: { type: 'string', description: 'Move in SAN notation' },
            fen: { type: 'string' },
            turn: { type: 'string' },
            isCheck: { type: 'boolean' },
            isCheckmate: { type: 'boolean' },
            isDraw: { type: 'boolean' },
            moveHistory: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      {
        name: 'get_board_state',
        description: 'Get the current board state including position, whose turn it is, move history, and game status.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            fen: { type: 'string' },
            turn: { type: 'string' },
            moveHistory: { type: 'array', items: { type: 'string' } },
            isCheck: { type: 'boolean' },
            isGameOver: { type: 'boolean' },
            status: { type: 'string' },
          },
        },
      },
      {
        name: 'get_legal_moves',
        description: 'Get all legal moves for the current position, or legal moves for a specific piece.',
        inputSchema: {
          type: 'object',
          properties: {
            square: { type: 'string', description: 'Optional: get moves for a specific square (e.g. "e2")' },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: {
            legalMoves: { type: 'object', description: 'Map of from-square to array of to-squares' },
            totalMoves: { type: 'number' },
          },
        },
      },
    ],
  },
  {
    name: 'Flashcard Quiz',
    slug: 'flashcards',
    description: 'Interactive flashcard quiz app for studying. Creates quizzes on any topic, tracks score, and shows results. Use when user wants to study, quiz themselves, review material, or practice flashcards.',
    icon_url: '📚',
    iframe_url: `${APPS_BASE}/flashcards/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'start_quiz',
        description: 'Start a flashcard quiz on a topic with a set of question/answer pairs.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Quiz topic' },
            cards: {
              type: 'array',
              description: 'Array of {question, answer} objects',
              items: {
                type: 'object',
                properties: {
                  question: { type: 'string' },
                  answer: { type: 'string' },
                },
              },
            },
          },
          required: ['topic', 'cards'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            totalCards: { type: 'number' },
            topic: { type: 'string' },
          },
        },
      },
      {
        name: 'get_results',
        description: 'Get the quiz results after the user has completed the quiz.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            total: { type: 'number' },
            percentage: { type: 'number' },
            incorrectTopics: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    ],
  },
  {
    name: 'Drawing Canvas',
    slug: 'canvas',
    description: 'A drawing canvas where users can draw, sketch, and create artwork. Use when user wants to draw, sketch, create diagrams, or do anything visual/artistic.',
    icon_url: '🎨',
    iframe_url: `${APPS_BASE}/canvas/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'open_canvas',
        description: 'Open the drawing canvas, optionally with a prompt or pre-configured settings.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Optional drawing prompt to display' },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, message: { type: 'string' } },
        },
      },
      {
        name: 'get_drawing_info',
        description: 'Get info about the current drawing (dimensions, stroke count).',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            strokeCount: { type: 'number' },
            isEmpty: { type: 'boolean' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
      },
    ],
  },
  {
    name: 'Spotify Playlist Creator',
    slug: 'spotify',
    description: 'Create and manage Spotify playlists. Search for tracks, build playlists, and connect to Spotify. Use when user mentions Spotify, wants to create a playlist, search for music, or manage their music.',
    icon_url: '🎵',
    iframe_url: `${APPS_BASE}/spotify/index.html`,
    auth_type: 'oauth2',
    oauth_config: {
      auth_url: 'https://accounts.spotify.com/authorize',
      token_url: 'https://accounts.spotify.com/api/token',
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      scopes: ['playlist-modify-public', 'playlist-modify-private', 'user-read-private'],
    },
    status: 'active',
    tools: [
      {
        name: 'search_tracks',
        description: 'Search for tracks on Spotify.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'number', description: 'Max results (default 10)' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            tracks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  artist: { type: 'string' },
                  album: { type: 'string' },
                },
              },
            },
          },
        },
      },
      {
        name: 'create_playlist',
        description: 'Create a new Spotify playlist.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Playlist name' },
            description: { type: 'string', description: 'Optional description' },
          },
          required: ['name'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            playlistId: { type: 'string' },
            name: { type: 'string' },
            url: { type: 'string' },
          },
        },
      },
    ],
  },
]

async function seed() {
  console.log('Seeding app registrations...')

  for (const app of apps) {
    const { error } = await supabaseAdmin
      .from('app_registrations')
      .upsert(app, { onConflict: 'slug' })

    if (error) {
      console.error(`Failed to seed ${app.slug}:`, error.message)
    } else {
      console.log(`✅ Seeded: ${app.name} (${app.slug})`)
    }
  }

  console.log('Seed complete.')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
