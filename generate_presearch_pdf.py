from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
import os

OUTPUT_PATH = r"C:\Users\rjxxl\projects\chatbridge\ChatBridge_Presearch.pdf"

# ── Colour palette ──────────────────────────────────────────────────────────
NAVY      = colors.HexColor("#0f1f3d")
MID_NAVY  = colors.HexColor("#1a3560")
ACCENT    = colors.HexColor("#2563eb")
LIGHT_BG  = colors.HexColor("#f0f4ff")
RULE_CLR  = colors.HexColor("#dbeafe")
WHITE     = colors.white
DARK_TEXT = colors.HexColor("#1e293b")
MUTED     = colors.HexColor("#64748b")
TABLE_HDR = colors.HexColor("#1e3a8a")
TABLE_ALT = colors.HexColor("#f8faff")
GREEN_CHK = colors.HexColor("#16a34a")

# ── Document setup ───────────────────────────────────────────────────────────
doc = SimpleDocTemplate(
    OUTPUT_PATH,
    pagesize=letter,
    leftMargin=0.85*inch, rightMargin=0.85*inch,
    topMargin=0.9*inch,   bottomMargin=0.9*inch,
    title="ChatBridge Pre-Search Document",
    author="RJ Ujadughele",
    subject="Week 7 Submission – TutorMeAI Case Study",
)

# ── Styles ───────────────────────────────────────────────────────────────────
base = getSampleStyleSheet()

def S(name, parent="Normal", **kw):
    return ParagraphStyle(name, parent=base[parent], **kw)

sTitle   = S("sTitle",   "Title",   fontSize=26, textColor=WHITE,
             fontName="Helvetica-Bold", alignment=TA_CENTER, spaceAfter=4)
sSubtitle= S("sSubtitle","Normal",  fontSize=12, textColor=colors.HexColor("#93c5fd"),
             fontName="Helvetica", alignment=TA_CENTER, spaceAfter=2)
sDate    = S("sDate",    "Normal",  fontSize=9,  textColor=colors.HexColor("#bfdbfe"),
             fontName="Helvetica", alignment=TA_CENTER)

sH1      = S("sH1",      "Heading1",fontSize=15, textColor=WHITE,
             fontName="Helvetica-Bold", spaceBefore=0, spaceAfter=0,
             leftIndent=0, leading=20)
sH2      = S("sH2",      "Heading2",fontSize=11, textColor=ACCENT,
             fontName="Helvetica-Bold", spaceBefore=14, spaceAfter=4)
sH3      = S("sH3",      "Heading3",fontSize=10, textColor=DARK_TEXT,
             fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=3)

sBody    = S("sBody",    "Normal",  fontSize=9.5, textColor=DARK_TEXT,
             fontName="Helvetica", leading=15, spaceAfter=6,
             alignment=TA_JUSTIFY)
sBullet  = S("sBullet",  "Normal",  fontSize=9.5, textColor=DARK_TEXT,
             fontName="Helvetica", leading=14, spaceAfter=3,
             leftIndent=14, firstLineIndent=-10)
sSmall   = S("sSmall",   "Normal",  fontSize=8.5, textColor=MUTED,
             fontName="Helvetica-Oblique", spaceAfter=4)
sLabel   = S("sLabel",   "Normal",  fontSize=8,   textColor=WHITE,
             fontName="Helvetica-Bold", alignment=TA_CENTER)
sSelected= S("sSelected","Normal",  fontSize=9,   textColor=GREEN_CHK,
             fontName="Helvetica-Bold")
sOption  = S("sOption",  "Normal",  fontSize=9.5, textColor=DARK_TEXT,
             fontName="Helvetica", leading=14, spaceAfter=4,
             leftIndent=14, firstLineIndent=-10)

# ── Helpers ──────────────────────────────────────────────────────────────────
def rule(color=RULE_CLR, thickness=0.5):
    return HRFlowable(width="100%", thickness=thickness,
                      color=color, spaceAfter=6, spaceBefore=2)

def section_header(number, title):
    """Navy banner with white text."""
    data = [[Paragraph(f"{number}  {title}", sH1)]]
    t = Table(data, colWidths=[doc.width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), NAVY),
        ("TOPPADDING",    (0,0), (-1,-1), 10),
        ("BOTTOMPADDING", (0,0), (-1,-1), 10),
        ("LEFTPADDING",   (0,0), (-1,-1), 14),
        ("RIGHTPADDING",  (0,0), (-1,-1), 14),
        ("ROUNDEDCORNERS",(0,0), (-1,-1), [6,6,6,6]),
    ]))
    return [Spacer(1, 10), t, Spacer(1, 8)]

def subsection(label_text):
    return [Paragraph(label_text, sH2), rule()]

def body(text):
    return Paragraph(text, sBody)

def bullet(text):
    return Paragraph(f"• {text}", sBullet)

def option_block(tag, text, selected=False):
    style = sSelected if selected else sOption
    prefix = "✓ " if selected else "○ "
    return Paragraph(f"{prefix}<b>{tag}</b> — {text}", style)

def make_table(headers, rows, col_widths=None):
    """Styled data table."""
    data = [[Paragraph(h, S(f"th_{i}", "Normal", fontSize=9,
                            textColor=WHITE, fontName="Helvetica-Bold",
                            alignment=TA_CENTER))
             for i, h in enumerate(headers)]]
    for ri, row in enumerate(rows):
        data.append([
            Paragraph(str(cell), S(f"td_{ri}_{ci}", "Normal", fontSize=8.5,
                                   textColor=DARK_TEXT, fontName="Helvetica",
                                   leading=13))
            for ci, cell in enumerate(row)
        ])

    if col_widths is None:
        col_widths = [doc.width / len(headers)] * len(headers)

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND",    (0, 0), (-1, 0), TABLE_HDR),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, TABLE_ALT]),
        ("GRID",          (0, 0), (-1, -1), 0.4, colors.HexColor("#c7d2fe")),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]
    t.setStyle(TableStyle(style))
    return t

# ── Cover page ───────────────────────────────────────────────────────────────
def cover():
    els = []
    # Hero banner
    hero_data = [[
        Paragraph("ChatBridge", sTitle),
        "",
    ]]
    hero = Table([[Paragraph("ChatBridge", sTitle)]],
                 colWidths=[doc.width])
    hero.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), NAVY),
        ("TOPPADDING",    (0,0),(-1,-1), 36),
        ("BOTTOMPADDING", (0,0),(-1,-1), 8),
        ("LEFTPADDING",   (0,0),(-1,-1), 20),
        ("RIGHTPADDING",  (0,0),(-1,-1), 20),
    ]))

    sub_data = [[Paragraph("Pre-Search Document", sSubtitle)]]
    sub_tbl  = Table(sub_data, colWidths=[doc.width])
    sub_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), NAVY),
        ("TOPPADDING",    (0,0),(-1,-1), 0),
        ("BOTTOMPADDING", (0,0),(-1,-1), 6),
    ]))

    case_data = [[Paragraph("Week 7 Submission  |  TutorMeAI Case Study", sDate)]]
    case_tbl  = Table(case_data, colWidths=[doc.width])
    case_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), NAVY),
        ("TOPPADDING",    (0,0),(-1,-1), 0),
        ("BOTTOMPADDING", (0,0),(-1,-1), 6),
    ]))

    date_data = [[Paragraph("March 30, 2026", sDate)]]
    date_tbl  = Table(date_data, colWidths=[doc.width])
    date_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), NAVY),
        ("TOPPADDING",    (0,0),(-1,-1), 0),
        ("BOTTOMPADDING", (0,0),(-1,-1), 36),
    ]))

    els += [Spacer(1, 60), hero, sub_tbl, case_tbl, date_tbl, Spacer(1, 40)]

    # Meta pills
    pills = [
        ("Platform", "ChatBridge"),
        ("Stack", "React · Express · Supabase · OpenAI"),
        ("Sprint", "7 days  |  3 checkpoints"),
        ("Apps", "Chess · Flashcards · Canvas · Spotify"),
    ]
    pill_rows = [[
        Paragraph(k, S("pk","Normal",fontSize=8,textColor=MUTED,fontName="Helvetica-Bold")),
        Paragraph(v, S("pv","Normal",fontSize=9,textColor=DARK_TEXT,fontName="Helvetica")),
    ] for k,v in pills]
    pill_tbl = Table(pill_rows, colWidths=[1.2*inch, doc.width-1.2*inch])
    pill_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0,0),(-1,-1), LIGHT_BG),
        ("GRID",          (0,0),(-1,-1), 0.3, RULE_CLR),
        ("TOPPADDING",    (0,0),(-1,-1), 6),
        ("BOTTOMPADDING", (0,0),(-1,-1), 6),
        ("LEFTPADDING",   (0,0),(-1,-1), 10),
        ("ROUNDEDCORNERS",(0,0),(-1,-1),[4,4,4,4]),
    ]))
    els += [pill_tbl, PageBreak()]
    return els

# ── BUILD STORY ──────────────────────────────────────────────────────────────
story = []
story += cover()

# ═══════════════════════════════════════════════════════
#  SECTION 1 — Case Study Analysis
# ═══════════════════════════════════════════════════════
story += section_header("01", "Case Study Analysis")

story.append(body(
    "TutorMeAI's competitive advantage has never been their chatbot — it's the control they give "
    "teachers. That distinction matters because the next phase of growth, embedding third-party apps "
    "inside the chat, threatens to erode exactly that advantage if the platform boundary isn't "
    "designed carefully."
))
story.append(body(
    "<b>The core tension is flexibility versus safety.</b> Third-party developers need enough freedom "
    "to build compelling apps — interactive chess boards, drawing tools, music integrations — but "
    "every degree of freedom is a potential vector for harm in a K-12 environment. A physics "
    "simulator that loads an external script, a flashcard app that phones home with student "
    "interaction data, a game with an embedded ad network — these aren't hypothetical risks when "
    "200,000 children are on the other side of the screen. The question isn't whether a bad actor "
    "will try to exploit the platform. It's when."
))
story.append(body(
    "We addressed this by choosing <b>sandboxed iframes</b> as the isolation boundary. Each "
    "third-party app runs in its own restricted container, unable to access the parent page, other "
    "apps, or student data beyond what's explicitly passed through a controlled messaging channel. "
    "This is the same model used by Figma, VS Code, and Shopify — proven at scale, understood by "
    "developers, and enforceable by the browser itself. The trade-off is performance and "
    "communication complexity: every interaction between the chatbot and an app must cross the "
    "iframe boundary through structured messages rather than direct function calls. We accepted that "
    "cost because the alternative — letting third-party code run in the same context as student data "
    "— is indefensible for a product serving children."
))
story.append(body(
    "<b>The second key problem is state awareness.</b> A chatbot that launches a chess game but "
    "can't discuss what happened mid-game is a gimmick, not a platform. The app must signal its "
    "current state back to the chatbot so the AI can respond contextually — analyzing a board "
    "position, reviewing quiz results, or suggesting next steps after a drawing session. This "
    "requires a bidirectional communication protocol simple enough for a third-party developer to "
    "implement in an afternoon but expressive enough to handle apps we haven't imagined yet. We "
    "landed on a hybrid approach: structured postMessage events for browser-based apps and webhook "
    "callbacks for server-side integrations, with a shared schema both the AI and apps understand."
))
story.append(body(
    "<b>The ethical dimension we weighed most carefully was data minimization.</b> It would be "
    "technically easier to give the chatbot full access to everything happening inside every app — "
    "but students don't consent to having their chess mistakes, drawing attempts, or music "
    "preferences fed into an AI's context window indefinitely. We designed the system so apps "
    "explicitly declare what state they share, and that state is scoped to the active conversation. "
    "When the conversation ends, the app context ends with it."
))
story.append(body(
    "Finally, we chose to give teachers the same gatekeeper role they already have. The plugin "
    "system doesn't expose a self-service app store. Apps are registered and reviewed before "
    "students see them. This preserves TutorMeAI's core differentiator — teacher control — while "
    "extending what that control can orchestrate. The platform grows, but the trust model stays intact."
))
story.append(Spacer(1, 10))

# ═══════════════════════════════════════════════════════
#  SECTION 2 — Technical Architecture
# ═══════════════════════════════════════════════════════
story += section_header("02", "Technical Architecture Overview")

story.append(body(
    "The platform is composed of three layers: a React SPA forked from Chatbox (web build), an "
    "Express + TypeScript backend that orchestrates AI calls and plugin routing, and Supabase for "
    "persistence and auth. Third-party apps are standalone Vite/React builds that run inside "
    "sandboxed iframes within the chat window. Communication between the chat platform and embedded "
    "apps flows exclusively through a typed postMessage protocol. When the LLM returns a function "
    "call, the Tool Orchestrator resolves which app owns the tool, dispatches it via postMessage to "
    "the active iframe, and feeds the result back to the LLM for a natural language follow-up."
))
story.append(Spacer(1,6))

story.append(make_table(
    ["Layer", "Technology", "Decision Rationale"],
    [
        ["Frontend",      "Chatbox fork (React + TypeScript + Vite)",  "PRD requirement; pnpm run build:web outputs deployable static SPA"],
        ["Backend",       "Express + TypeScript",                       "Shared types with frontend; Vercel AI SDK native; SSE streaming support"],
        ["Database",      "Supabase (PostgreSQL)",                      "Managed DB + auth + storage in one service; generous free tier"],
        ["Auth",          "Supabase Auth",                              "Built-in JWT-based auth; no reinventing the wheel"],
        ["LLM",           "OpenAI GPT-4o-mini",                         "Best function calling support; $0.15/1M input tokens"],
        ["App Sandboxing","Sandboxed iframes + postMessage",            "Browser-native isolation; K-12 safety standard"],
        ["Deployment",    "Vercel (frontend) + Railway (backend)",       "Static SPA on Vercel; Express server on Railway"],
    ],
    col_widths=[1.1*inch, 1.9*inch, 3.5*inch]
))
story.append(Spacer(1, 10))

# ═══════════════════════════════════════════════════════
#  SECTION 3 — Phase 1 Constraints
# ═══════════════════════════════════════════════════════
story += section_header("03", "Planning Checklist — Phase 1: Define Your Constraints")

story += subsection("3.1  Scale & Load Profile")
story.append(bullet("<b>At launch:</b> Single developer submission; grader testing (~5–10 concurrent users)."))
story.append(bullet("<b>6-month projection:</b> 1,000–10,000 MAUs across school districts if adopted by TutorMeAI."))
story.append(bullet("<b>Traffic pattern:</b> Spiky — school hours 8am–3pm local time, peaks at class start/end. Minimal weekends."))
story.append(bullet("<b>Concurrent app sessions:</b> 1 active iframe at a time per user. Multiple apps may be registered in a conversation but only one runs simultaneously."))
story.append(bullet("<b>Cold start tolerance:</b> Moderate. Iframe apps load from CDN — target under 2 seconds. Loading indicators required for all async operations."))

story += subsection("3.2  Budget & Cost Ceiling")
story.append(bullet("<b>Development budget:</b> ~$15–20 total (OpenAI API calls only). All infrastructure on free tiers."))
story.append(bullet("<b>Production at 1K users/month:</b> ~$69/month (OpenAI $34 + Supabase Pro $25 + Railway $10)."))
story.append(bullet("<b>Pay-per-use:</b> Acceptable. LLM costs scale linearly with usage, bounded by school hours."))
story.append(bullet("<b>LLM cost per tool invocation:</b> ~$0.0004 at GPT-4o-mini pricing. Per-user monthly LLM cost: ~$0.034."))
story.append(bullet("<b>GPT-4o-mini over GPT-4o:</b> ~17x cheaper with acceptable quality for structured educational tool calling."))

story += subsection("3.3  Time to Ship")
story.append(bullet("<b>MVP (24 hrs — Tuesday):</b> Basic chat + auth + pre-search doc."))
story.append(bullet("<b>Full plugin system (4 days — Friday):</b> All 4 apps working, plugin architecture complete."))
story.append(bullet("<b>Final (7 days — Sunday):</b> Deployed, documented, submitted."))
story.append(bullet("<b>Speed vs. maintainability:</b> Speed prioritized. TypeScript throughout provides structural safety. Shared types between frontend and backend prevent interface drift."))

story += subsection("3.4  Security & Sandboxing")
story.append(bullet('<b>Iframe isolation:</b> sandbox="allow-scripts" only. allow-same-origin explicitly excluded — iframe treated as cross-origin, cannot access parent DOM, localStorage, or cookies.'))
story.append(bullet("<b>Malicious app registration:</b> Admin-only registration. No self-service app store. All apps reviewed before student exposure."))
story.append(bullet("<b>CSP:</b> default-src 'self'; frame-src https://apps.chatbridge.com; script-src 'self'. Restricts iframe load origins."))
story.append(bullet("<b>postMessage security:</b> Origin validated against registered iframe_url domain. Malformed messages silently dropped."))
story.append(bullet("<b>Data privacy:</b> Apps receive only explicitly passed tool parameters. Cannot query conversation history or other app states. State scoped to active conversation only."))

story += subsection("3.5  Team & Skill Constraints")
story.append(bullet("<b>Team:</b> Solo developer (AI-assisted)."))
story.append(bullet("<b>Decision principle:</b> Structural integrity prioritized over stack familiarity. All choices made on architectural merit."))
story.append(bullet("<b>iframe/postMessage:</b> Well-documented browser API. Figma plugin API and VS Code webview provide clear reference patterns."))
story.append(bullet("<b>OAuth2:</b> Authorization Code + PKCE flow for Spotify. Express handles server-side callback and token exchange."))
story.append(Spacer(1, 6))

# ═══════════════════════════════════════════════════════
#  SECTION 4 — Phase 2 Architecture Discovery
# ═══════════════════════════════════════════════════════
story += section_header("04", "Planning Checklist — Phase 2: Architecture Discovery")

story += subsection("4.1  Plugin Architecture — Alternatives Considered")

story.append(option_block(
    "Option A — Sandboxed iframes + postMessage", "SELECTED",
    selected=True
))
story.append(body(
    "Each app is a standalone web page loaded in an iframe with sandbox=\"allow-scripts\". "
    "Communication via window.postMessage with typed message protocol. Industry-proven (Figma, "
    "VS Code, Shopify). Strong isolation by default. Security is non-negotiable for K-12 — "
    "iframes with postMessage are the browser's built-in answer to this problem."
))
story.append(option_block("Option B — Web Components / Shadow DOM", "REJECTED"))
story.append(body(
    "Apps registered as custom HTML elements. Shadow DOM provides style isolation but NOT "
    "JavaScript isolation. App code runs in the same JS context as the platform — a malicious "
    "app could access student data. Rejected for K-12 safety."
))
story.append(option_block("Option C — Server-Side Rendering", "REJECTED"))
story.append(body(
    "Platform renders app UI server-side and sends HTML to chat. No client-side third-party "
    "code execution. Maximum security but minimal interactivity — incompatible with real-time "
    "apps like chess. Rejected."
))

story += subsection("4.2  LLM & Function Calling — Alternatives Considered")
story.append(make_table(
    ["Option", "Cost (input/output per 1M)", "Status", "Notes"],
    [
        ["GPT-4o-mini",       "$0.15 / $0.60",   "✓ SELECTED", "Best function calling; Vercel AI SDK native; lowest cost"],
        ["Claude 3.5 Haiku",  "$0.25 / $1.25",   "✗ Rejected",  "2–5x more expensive; different tool-use API"],
        ["GPT-4o",            "$2.50 / $10.00",   "✗ Rejected",  "17x more expensive; marginal quality gain for structured tasks"],
    ],
    col_widths=[1.3*inch, 1.6*inch, 1.1*inch, 2.5*inch]
))
story.append(Spacer(1,8))
story.append(body(
    "Dynamic tool schema injection: All registered app tool schemas injected into the OpenAI "
    "request as function definitions on every chat turn. With 4 apps × 4 tools = 16 definitions "
    "adding ~2,000–3,000 tokens — well within GPT-4o-mini's 128K context window."
))

story += subsection("4.3  Real-Time Communication — Alternatives Considered")
story.append(option_block("Option A — SSE + REST + postMessage", "SELECTED", selected=True))
story.append(body(
    "Server-Sent Events for LLM streaming. REST for all other actions. postMessage for iframe "
    "communication. Simple, HTTP/1.1 compatible, standard pattern for LLM streaming applications."
))
story.append(option_block("Option B — WebSockets for everything", "REJECTED"))
story.append(body(
    "Full duplex. More powerful but requires persistent connection management and reconnection "
    "logic. LLM streaming is inherently one-directional (server to client) — the added complexity "
    "is not justified."
))
story.append(option_block("Option C — Supabase Realtime + postMessage", "REJECTED"))
story.append(body(
    "Supabase pub/sub for chat updates. Reduces backend code but creates tight coupling to "
    "Supabase's realtime infrastructure. Rejected to keep the backend self-contained."
))

story += subsection("4.4  State Management")
story.append(bullet("<b>Chat state:</b> Conversation history in Supabase messages table. Each row stores role, content, and optional app_context (JSONB snapshot of app state at time of message)."))
story.append(bullet("<b>App state:</b> Apps maintain internal state and send state_update postMessage events. Platform holds latest snapshot in React Plugin Manager state. Injected into next OpenAI request as system context."))
story.append(bullet("<b>App context injection:</b> \"The user is currently using [App Name]. Current state: [JSON snapshot].\""))
story.append(bullet("<b>Page refresh:</b> Conversation messages persist in Supabase. App state does NOT persist — acceptable MVP trade-off."))
story.append(bullet("<b>Chat close:</b> Plugin Manager sends app_close to active iframe before unmounting. Completion summary preserved in conversation history."))

story += subsection("4.5  Authentication Architecture — Three Tiers")
story.append(make_table(
    ["Tier", "Apps", "Auth Pattern", "Implementation"],
    [
        ["Internal",    "Chess, Flashcards, Canvas",  "No auth",        "Apps receive tool parameters only"],
        ["Public API",  "Weather (example)",           "API key",        "Stored server-side as env vars, never sent to frontend"],
        ["OAuth2",      "Spotify",                     "Authorization Code + PKCE", "Platform handles full flow: authorize → callback → encrypted token storage → auto-refresh"],
    ],
    col_widths=[0.8*inch, 1.5*inch, 1.5*inch, 2.7*inch]
))
story.append(Spacer(1,8))
story.append(body(
    "<b>OAuth in iframe context:</b> Spotify's OAuth redirect cannot complete inside a sandboxed "
    "iframe. Solution: OAuth flow is initiated as a platform-level redirect. User returns to the "
    "platform callback URL, tokens are stored encrypted in Supabase, then the Spotify iframe is "
    "mounted with the token available via tool invocation. Tokens never sent to the frontend."
))

story += subsection("4.6  Database & Persistence")
story.append(make_table(
    ["Table", "Key Fields", "Notes"],
    [
        ["conversations",    "id, user_id, title, timestamps",                                          "Read-heavy; indexed on user_id"],
        ["messages",         "id, conversation_id, role, content, tool_call_id, app_context (JSONB)",   "Append-only; indexed on conversation_id"],
        ["app_registrations","id, slug, iframe_url, auth_type, oauth_config (JSONB), tools (JSONB[])",  "Read-heavy (every chat request); rarely written"],
        ["tool_invocations", "id, app_id, tool_name, parameters, result, duration_ms, status",          "Enables debugging + cost tracking"],
        ["oauth_tokens",     "id, user_id, app_id, access_token (enc), refresh_token (enc), expires_at","Encrypted at rest; indexed on user_id + app_id"],
    ],
    col_widths=[1.4*inch, 2.5*inch, 2.6*inch]
))
story.append(Spacer(1, 10))

# ═══════════════════════════════════════════════════════
#  SECTION 5 — Phase 3 Post-Stack Refinement
# ═══════════════════════════════════════════════════════
story += section_header("05", "Planning Checklist — Phase 3: Post-Stack Refinement")

story += subsection("5.1  Security & Sandboxing Deep Dive")
story.append(bullet('<b>iframe sandbox:</b> sandbox="allow-scripts" only. Denies same-origin access, form submission, popups, top-level navigation.'))
story.append(bullet("<b>CSP:</b> default-src 'self'; frame-src https://apps.chatbridge.com; script-src 'self'."))
story.append(bullet("<b>DOM prevention:</b> Automatic via omission of allow-same-origin. Browser enforces synthetic cross-origin boundary."))
story.append(bullet("<b>Rate limiting:</b> /api/chat — 30 req/min per user. Tool invocations — 10/min per app per user. Implemented via express-rate-limit."))

story += subsection("5.2  Error Handling & Resilience")
story.append(bullet("<b>iframe load failure:</b> 10-second timeout. On failure, tool_result error returned to LLM. Conversation continues without the app."))
story.append(bullet("<b>Tool call timeout:</b> 30-second timeout. No tool_result postMessage within 30s → error result returned to LLM."))
story.append(bullet('<b>Chatbot recovery:</b> System prompt instructs: "If a tool invocation fails or times out, acknowledge it naturally and offer to help another way."'))
story.append(bullet("<b>Circuit breaker:</b> 3 consecutive failures within 5 minutes → app temporarily disabled for the session. LLM informed of unavailability."))

story += subsection("5.3  Testing Strategy")
story.append(bullet("<b>Plugin interface isolation:</b> Mock app sends predetermined message sequences. Unit tests verify origin validation, message shape validation, error handling."))
story.append(bullet('<b>Integration testing:</b> Minimal "echo app" accepts any tool invocation and returns canned result. Tests Tool Orchestrator without real app builds.'))
story.append(bullet("<b>E2E lifecycle testing:</b> Manual test script covering all 7 PRD scenarios: tool discovery, UI render, completion signaling, context retention, app switching, ambiguous routing, refusal of unrelated queries."))
story.append(bullet("<b>Load testing:</b> Not in scope for 7-day sprint. Artillery or k6 for production hardening phase."))

story += subsection("5.4  Developer Experience")
story.append(bullet("<b>Time to 'hello world' plugin:</b> Under 2 hours. Build a web page → add postMessage bridge script → define OpenAI tool schemas → register via admin API."))
story.append(bullet("<b>Documentation:</b> Registration endpoint, tool schema format, postMessage protocol (TypeScript interfaces for all message types), complete reference implementation (Flashcard app)."))
story.append(bullet("<b>Local dev:</b> Point iframe_url to localhost. CORS and CSP relaxed in development mode."))
story.append(bullet("<b>Debugging:</b> Plugin Manager logs all postMessage events to browser console in dev mode. Tool invocations logged to tool_invocations table server-side."))

story += subsection("5.5  Deployment & Operations")
story.append(bullet("<b>App hosting:</b> Static Vite builds deployed to Vercel. Each app gets its own path: /apps/chess, /apps/flashcards, /apps/canvas, /apps/spotify."))
story.append(bullet("<b>CI/CD:</b> GitLab CI pipeline — lint → type-check → build all packages → deploy frontend to Vercel → deploy backend to Railway. Triggered on push to main."))
story.append(bullet("<b>Monitoring:</b> Railway (CPU/memory/requests), Supabase dashboard (DB + auth events), OpenAI usage dashboard (token consumption + costs)."))
story.append(bullet("<b>App updates:</b> For this sprint, all apps deploy atomically with the platform. Post-sprint: version field in app_registrations; active sessions pin to running version."))
story.append(Spacer(1, 6))

# ═══════════════════════════════════════════════════════
#  SECTION 6 — Cost Analysis
# ═══════════════════════════════════════════════════════
story += section_header("06", "Cost Analysis")

story += subsection("Development Costs (7-Day Sprint)")
story.append(make_table(
    ["Phase", "Duration", "OpenAI API Cost", "Infrastructure"],
    [
        ["Phase 1: Foundation",          "1 day",  "~$2",  "Free tiers"],
        ["Phase 2: Plugin System + Chess","2 days", "~$5",  "Free tiers"],
        ["Phase 3: Additional Apps",     "2 days", "~$5",  "Free tiers"],
        ["Phase 4: Polish + Deploy",     "2 days", "~$3",  "Free tiers"],
        ["Total",                        "7 days", "~$15", "$0"],
    ],
    col_widths=[2.2*inch, 1.0*inch, 1.2*inch, 2.1*inch]
))
story.append(Spacer(1, 12))

story += subsection("Production Costs at Scale")
story.append(sSmall and Paragraph(
    "Assumptions: 15 messages/session · 3 tool invocations/session · 8 sessions/user/month · "
    "500 input tokens/message · 300 output tokens/message · 800 tokens/tool call · "
    "per-user monthly LLM cost ~$0.034",
    sSmall
))
story.append(Spacer(1, 4))
story.append(make_table(
    ["Component", "100 users/mo", "1K users/mo", "10K users/mo", "100K users/mo"],
    [
        ["OpenAI GPT-4o-mini",  "$3.40",      "$34",        "$340",         "$3,400"],
        ["Supabase",            "$0 (free)",  "$25 (Pro)",  "$75",          "$599 (Team)"],
        ["Railway",             "$5",         "$10",        "$30",          "$100+"],
        ["Vercel",              "$0 (free)",  "$0 (free)",  "$20 (Pro)",    "$20 (Pro)"],
        ["Supabase Storage",    "$0",         "$0",         "$25",          "$75"],
        ["Spotify API",         "$0 (free)",  "$0 (free)",  "$0 (free)",    "$0 (free)"],
        ["Monthly Total",       "~$8.40",     "~$69",       "~$490",        "~$4,194"],
    ],
    col_widths=[1.6*inch, 1.1*inch, 1.1*inch, 1.15*inch, 1.55*inch]
))
story.append(Spacer(1, 10))

# ═══════════════════════════════════════════════════════
#  SECTION 7 — Key Decisions Summary
# ═══════════════════════════════════════════════════════
story += section_header("07", "Key Architectural Decisions Summary")

story.append(make_table(
    ["Decision", "Choice Made", "Key Alternative Rejected", "Reason"],
    [
        ["App isolation",        "Sandboxed iframes",               "Web Components",              "allow-same-origin vulnerability unacceptable for K-12"],
        ["Backend language",     "TypeScript / Express",            "Python / FastAPI",            "Shared types with React frontend; Vercel AI SDK native"],
        ["Database + Auth",      "Supabase",                        "Neon + Auth.js",              "Single service for DB, auth, storage, and realtime"],
        ["LLM",                  "GPT-4o-mini",                     "Claude 3.5 Haiku",            "5x cheaper; best-in-class function calling support"],
        ["Tool schema format",   "OpenAI native",                   "Custom schema + adapter",     "No translation layer; direct pass-through to LLM"],
        ["Completion signaling", "Hybrid (postMessage + webhooks)", "postMessage only",            "Webhooks required for server-side integrations (Spotify)"],
        ["Real-time comms",      "SSE + REST",                      "WebSockets",                  "LLM streaming is one-directional; SSE is simpler and sufficient"],
        ["OAuth handling",       "Server-side redirect",            "In-iframe redirect",          "Sandboxed iframes cannot complete OAuth redirects"],
    ],
    col_widths=[1.2*inch, 1.4*inch, 1.4*inch, 2.5*inch]
))
story.append(Spacer(1, 20))
story.append(rule(NAVY, 1))
story.append(Paragraph("ChatBridge — Pre-Search Document  |  Week 7  |  March 30, 2026", sSmall))

# ── Build ─────────────────────────────────────────────────────────────────────
doc.build(story)
print(f"PDF created: {OUTPUT_PATH}")
print(f"File size: {os.path.getsize(OUTPUT_PATH) / 1024:.1f} KB")
