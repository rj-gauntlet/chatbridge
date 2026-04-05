import 'dotenv/config'
import { supabaseAdmin } from '../services/supabase'

/**
 * Seeds the app_registrations table with the four built-in ChatBridge apps.
 * Run with: npx tsx src/seed/apps.ts
 */

// Apps are served as static files from the backend at /apps/<slug>/
// Set BACKEND_URL to the Railway deployment URL in production
// e.g. BACKEND_URL=https://chatbridge-production-9505.up.railway.app
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const APPS_BASE = `${BACKEND_URL}/apps`

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
        description: 'Start a new chess game. Resets the board to the initial position. IMPORTANT: Always pass color="b" if the user wants to play as Black, color="w" for White (default). When player is Black, the AI will make the first move automatically — the result will include aiFirstMove.',
        inputSchema: {
          type: 'object',
          properties: {
            color: { type: 'string', description: 'Player color: "w" for White (default), "b" for Black' },
            message: { type: 'string', description: 'Optional opening message to display' },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            playerColor: { type: 'string', description: 'The color the human player is playing: w or b' },
            fen: { type: 'string', description: 'Board position in FEN notation after any AI first move' },
            turn: { type: 'string', description: 'Whose turn it is next: w or b' },
            aiFirstMove: { type: 'string', description: 'The AI\'s opening move in SAN notation (only present when player is Black)' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make the HUMAN PLAYER\'s chess move. Validates the move, updates the board, then automatically triggers the AI opponent\'s response. NEVER call this tool for the AI opponent — the AI move happens automatically and is returned in the result as aiMove. Only call this tool once per user turn.',
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
            playerMove: { type: 'string', description: 'The human player\'s move in SAN notation' },
            aiMove: { type: 'string', description: 'The AI opponent\'s automatic response move in SAN notation (null if game over)' },
            fen: { type: 'string', description: 'Board position after both moves' },
            turn: { type: 'string', description: 'Whose turn it is next (should be the player\'s again)' },
            isCheck: { type: 'boolean' },
            isCheckmate: { type: 'boolean' },
            isDraw: { type: 'boolean' },
            moveHistory: { type: 'array', items: { type: 'string' } },
            message: { type: 'string', description: 'Human-readable summary of both moves' },
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
    sandbox_permissions: 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin',
    permission_policy: 'encrypted-media; autoplay',
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
      {
        name: 'get_playback_state',
        description: 'Returns the current playback state: whether music is actively streaming, the track name, artist, progress, and playback mode (sdk = Premium full track, preview = 30-sec clip, none = nothing playing). Use this to verify playback is actually happening, or to check what is currently playing before responding to control requests.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            isPlaying: { type: 'boolean', description: 'True if audio is actively streaming right now' },
            track: { type: 'string' },
            artist: { type: 'string' },
            album: { type: 'string' },
            progressMs: { type: 'number', description: 'Current playback position in milliseconds' },
            durationMs: { type: 'number', description: 'Total track duration in milliseconds' },
            mode: { type: 'string', description: '"sdk", "preview", or "none"' },
          },
        },
      },
    ],
  },
  // ── Desmos Graphing Calculator ─────────────────────────────────────────────
  {
    name: 'Desmos Graphing Calculator',
    slug: 'desmos',
    description: 'Interactive Desmos graphing calculator. Plots mathematical functions, equations, inequalities, and parametric curves. Use when the user wants to graph a function, visualize an equation, explore mathematical curves, or plot data.',
    icon_url: '📈',
    iframe_url: `${APPS_BASE}/desmos/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'add_expression',
        description: 'Add or update a mathematical expression on the Desmos graph. Supports functions (y=x^2), equations (x^2+y^2=25), inequalities (y>x), parametric curves, and constants. Use LaTeX notation. Optionally specify an id to update an existing expression.',
        inputSchema: {
          type: 'object',
          properties: {
            latex: { type: 'string', description: 'LaTeX math expression to graph (e.g. "y=x^2", "x^2+y^2=25", "y>\\sin(x)")' },
            id: { type: 'string', description: 'Optional identifier. Omit to auto-generate. Reuse the same id to update an existing expression.' },
            color: { type: 'string', description: 'Optional hex color for the graph line (e.g. "#c74440")' },
          },
          required: ['latex'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            id: { type: 'string', description: 'The expression id — use this to remove or update it later' },
            latex: { type: 'string' },
            expressionCount: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'remove_expression',
        description: 'Remove a specific expression from the graph by its id. Call get_expressions first if you do not know the id.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The expression id to remove' },
          },
          required: ['id'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            removedId: { type: 'string' },
            expressionCount: { type: 'number' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'set_viewport',
        description: 'Set the visible x/y bounds of the graph window. Use to zoom in on a region or show a wider range.',
        inputSchema: {
          type: 'object',
          properties: {
            left:   { type: 'number', description: 'Left x bound (e.g. -10)' },
            right:  { type: 'number', description: 'Right x bound (e.g. 10)' },
            bottom: { type: 'number', description: 'Bottom y bound (e.g. -10)' },
            top:    { type: 'number', description: 'Top y bound (e.g. 10)' },
          },
          required: ['left', 'right', 'bottom', 'top'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            viewport: { type: 'object' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'clear_graph',
        description: 'Remove all expressions from the graph, returning it to a blank state.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'get_expressions',
        description: 'Get the current list of all expressions on the graph including their ids and LaTeX. Use before making changes if you are unsure what is currently graphed.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            expressions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  latex: { type: 'string' },
                  color: { type: 'string' },
                  hidden: { type: 'boolean' },
                },
              },
            },
            expressionCount: { type: 'number' },
          },
        },
      },
    ],
  },
  {
    name: 'Code Playground',
    slug: 'code',
    description: 'Interactive JavaScript code editor and runner. AI can set code, run it, read what the student typed, and display exercise prompts. Use when user wants to write code, learn programming, practice JavaScript, or do coding exercises.',
    icon_url: '💻',
    iframe_url: `${APPS_BASE}/code/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'set_code',
        description: 'Replace the editor contents with new code',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'The code to set in the editor' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
      {
        name: 'run_code',
        description: 'Execute the current code (or provided code) and return console output and any errors',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Optional code to set before running. If omitted, runs current editor content.' },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: {
            output: { type: 'string', description: 'Console output from execution' },
            error: { type: 'string', description: 'Error message if execution failed' },
          },
        },
      },
      {
        name: 'get_code',
        description: 'Read the current contents of the code editor (what the student has typed)',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
        },
      },
      {
        name: 'set_prompt',
        description: 'Display exercise instructions or a problem description above the editor',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The exercise instructions to display' },
          },
          required: ['prompt'],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
    ],
  },
  {
    name: 'World Map',
    slug: 'worldmap',
    description: 'Interactive world map for geography education. AI can fly to locations, place markers, highlight regions, and clear the map. Use when user asks about geography, countries, locations, capitals, trade routes, or wants to explore the world map.',
    icon_url: '🗺️',
    iframe_url: `${APPS_BASE}/worldmap/index.html`,
    auth_type: 'internal',
    status: 'active',
    tools: [
      {
        name: 'fly_to',
        description: 'Pan and zoom the map to a specific location',
        inputSchema: {
          type: 'object',
          properties: {
            lat: { type: 'number', description: 'Latitude' },
            lng: { type: 'number', description: 'Longitude' },
            zoom: { type: 'number', description: 'Zoom level (1-18, default 10)' },
            name: { type: 'string', description: 'Optional place name to show as popup' },
          },
          required: ['lat', 'lng'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
            zoom: { type: 'number' },
          },
        },
      },
      {
        name: 'add_marker',
        description: 'Place a labeled marker pin on the map',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique marker ID' },
            lat: { type: 'number', description: 'Latitude' },
            lng: { type: 'number', description: 'Longitude' },
            label: { type: 'string', description: 'Marker label text' },
            description: { type: 'string', description: 'Optional popup description' },
          },
          required: ['id', 'lat', 'lng', 'label'],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, markerId: { type: 'string' } },
        },
      },
      {
        name: 'remove_marker',
        description: 'Remove a marker from the map by ID',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ID of the marker to remove' },
          },
          required: ['id'],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
      {
        name: 'highlight_region',
        description: 'Highlight a geographic region on the map using GeoJSON',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique region ID' },
            geojson: { type: 'object', description: 'GeoJSON geometry object for the region' },
            color: { type: 'string', description: 'Fill color (default #3388ff)' },
          },
          required: ['id', 'geojson'],
        },
        outputSchema: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
      {
        name: 'clear_map',
        description: 'Remove all markers and highlighted regions from the map',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            cleared: { type: 'object', properties: { markers: { type: 'number' }, highlights: { type: 'number' } } },
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
