# Chess Diary

A web application for tracking your thought process during daily chess games on Chess.com and analyzing them with engine analysis.

## Features

- 📝 **Daily Journal** - Record general thoughts and game-specific analysis organized by date
- ♟️ **Game Tracking** - Select from your active Chess.com games and track your thinking move-by-move
- 🎯 **Dual Entry Modes** - Switch between general reflections and game-specific thoughts
- 📊 **Game Management** - Automatically fetch and organize your Chess.com daily games
- 🤖 **Analysis Ready** - Framework prepared for Stockfish engine integration (coming soon)

## Screenshots

*(Add your own screenshots here if you'd like)*

## Tech Stack

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Modern, utility-first styling
- **JSON Storage** - Simple file-based data persistence (perfect for single-user)
- **chess.js** - Chess logic and move validation
- **Chess.com API** - Game data integration

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Chess.com account with daily games

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/chess-diary.git
cd chess-diary
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

### First Time Setup

1. Navigate to **Settings** and enter your Chess.com username
2. Go to **Games** and click "Fetch from Chess.com" to import your games
3. Head to **Journal** to start recording your thoughts!

## How to Use

### Daily Journal

The journal is organized by date and supports two types of entries:

**📝 General Thoughts**
- Daily reflections on your chess progress
- Feelings about your play
- Learning insights
- Any chess-related musings

**♟️ Game-Specific Entries**
- Select an active game from your list
- Record your thought process for specific moves
- Note alternative lines you considered
- Document your positional understanding

### Workflow

1. **Morning**: Write general thoughts about your chess goals for the day
2. **During Games**: Switch to game mode, select your active game, and record your thinking as you play
3. **Evening**: Reflect on the day's games and add general insights
4. **Analysis** (coming soon): Run engine analysis to compare your thoughts with optimal play

## Project Structure

```
chess-diary/
├── app/                      # Next.js App Router
│   ├── page.tsx             # Home page
│   ├── layout.tsx           # Root layout with navigation
│   ├── journal/             # Daily journal interface
│   ├── games/               # Game list and individual game views
│   ├── settings/            # Configuration page
│   └── api/                 # API routes
│       ├── games/           # Game management endpoints
│       ├── journal/         # Journal entry endpoints
│       └── settings/        # Settings endpoints
├── lib/
│   ├── db.ts                # JSON-based data storage
│   ├── chesscom.ts          # Chess.com API client
│   └── stockfish.ts         # Engine analysis (placeholder)
├── types/
│   └── index.ts             # TypeScript type definitions
└── components/              # Reusable UI components
```

## Data Storage

All data is stored locally in `chess-diary-data.json` with the following structure:

- **games**: Dictionary of game objects keyed by game ID
- **journal_entries**: Array of journal entries with date, game reference, and content
- **move_analysis**: Array of engine analysis results (future feature)
- **settings**: Key-value pairs for configuration (e.g., Chess.com username)

## API Endpoints

### Games
- `GET /api/games` - List all games
- `GET /api/games/fetch?year=2026&month=1` - Fetch games from Chess.com

### Journal
- `GET /api/journal?date=2026-01-31` - Get entries for a specific date
- `POST /api/journal` - Create a new journal entry

### Settings
- `GET /api/settings` - Get all settings
- `POST /api/settings` - Save a setting

## Roadmap

- [x] Daily journal with general and game-specific entries
- [x] Chess.com game integration
- [x] Active game selection
- [ ] Stockfish engine integration for position analysis
- [ ] Move-by-move comparison view
- [ ] Analysis reports showing thought quality
- [ ] Word document import for existing diary entries
- [ ] Visual chess board display
- [ ] Export journal as PDF
- [ ] Mobile-optimized interface

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Lint code
npm run lint
```

## Contributing

This is a personal project, but feel free to fork it and adapt it for your own use! If you make improvements, I'd love to hear about them.

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- Chess.com for their excellent public API
- Next.js team for the amazing framework
- Stockfish for chess engine capabilities (integration coming soon)

## Contact

Feel free to reach out if you have questions or suggestions!

---

**Happy chess learning! 🎯♟️**
