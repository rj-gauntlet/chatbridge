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
        description: 'Start a flashcard quiz on a topic. Available topics: math, science, history, vocabulary.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Quiz topic: math, science, history, or vocabulary' },
            cardCount: { type: 'number', description: 'Number of cards (1-10, default 5)' },
          },
          required: ['topic'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            topic: { type: 'string' },
            totalCards: { type: 'number' },
            firstQuestion: { type: 'string' },
          },
        },
      },
      {
        name: 'get_question',
        description: 'Get the current question in the active quiz.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            questionNumber: { type: 'number' },
            totalQuestions: { type: 'number' },
            question: { type: 'string' },
            topic: { type: 'string' },
          },
        },
      },
      {
        name: 'submit_answer',
        description: 'Submit an answer for the current quiz question.',
        inputSchema: {
          type: 'object',
          properties: { answer: { type: 'string', description: 'The user\'s answer' } },
          required: ['answer'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            correct: { type: 'boolean' },
            correctAnswer: { type: 'string' },
            userAnswer: { type: 'string' },
            score: { type: 'number' },
            questionsRemaining: { type: 'number' },
          },
        },
      },
      {
        name: 'get_results',
        description: 'Get the quiz results. Call after all questions are answered.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            total: { type: 'number' },
            percentage: { type: 'number' },
            grade: { type: 'string' },
            topic: { type: 'string' },
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
        name: 'save_drawing',
        description: 'Save the current drawing and signal completion.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            strokeCount: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'clear_canvas',
        description: 'Clear the drawing canvas.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, message: { type: 'string' } },
        },
      },
      {
        name: 'get_drawing_info',
        description: 'Get info about the current drawing (stroke count, dimensions).',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            strokeCount: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            lastColor: { type: 'string' },
            lastBrushSize: { type: 'number' },
          },
        },
      },
    ],
  },
  {
    name: 'Spotify Player',
    slug: 'spotify',
    description: 'AI-controlled Spotify music player. Plays tracks, pauses, resumes, skips, adjusts volume, and queues songs. Supports Spotify Premium for full songs or free accounts for 30-second previews. Use when user wants to listen to music, play a specific song, or control music playback.',
    icon_url: '🎵',
    iframe_url: `${APPS_BASE}/spotify/index.html`,
    auth_type: 'oauth2',
    oauth_config: {
      auth_url: 'https://accounts.spotify.com/authorize',
      token_url: 'https://accounts.spotify.com/api/token',
      client_id: process.env.SPOTIFY_CLIENT_ID || '',
      scopes: [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
      ],
    },
    status: 'active',
    tools: [
      {
        name: 'play_track',
        description: 'Search for a track and play it immediately. Use for requests like "play Smells Like Teen Spirit" or "put on some jazz".',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Song name, artist, or search query' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            track: { type: 'string' },
            artist: { type: 'string' },
            album: { type: 'string' },
            mode: { type: 'string', description: '"sdk" for Premium full track, "preview" for 30-second clip' },
            error: { type: 'string' },
          },
        },
      },
      {
        name: 'pause_playback',
        description: 'Pause the currently playing track.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
      },
      {
        name: 'resume_playback',
        description: 'Resume the paused track.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' } } },
      },
      {
        name: 'set_volume',
        description: 'Set playback volume from 0 (mute) to 100 (full).',
        inputSchema: {
          type: 'object',
          properties: {
            level: { type: 'number', description: 'Volume level 0–100' },
          },
          required: ['level'],
        },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, level: { type: 'number' } } },
      },
      {
        name: 'skip_to_next',
        description: 'Skip to the next track in the queue.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'object', properties: { success: { type: 'boolean' }, track: { type: 'string' } } },
      },
      {
        name: 'queue_track',
        description: 'Add a track to the playback queue without stopping current track.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Song name or artist to search and queue' },
          },
          required: ['query'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            track: { type: 'string' },
            artist: { type: 'string' },
            queueLength: { type: 'number' },
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
