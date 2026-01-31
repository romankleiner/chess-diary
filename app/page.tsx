export default function Home() {
  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Welcome to Chess Diary</h2>
      
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <p className="text-lg mb-4">
          A day-by-day journal for tracking your thoughts during chess games and analyzing them with engine analysis.
        </p>
        
        <div className="space-y-4">
          <div>
            <h3 className="text-xl font-semibold mb-2">How It Works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>Configure your Chess.com username in Settings</li>
              <li>Open your Journal for today</li>
              <li>Start tracking a game by pasting the Chess.com game URL</li>
              <li>Record your thoughts as you play each move</li>
              <li>When the game finishes, analyze it to compare your thinking with the engine</li>
            </ol>
          </div>
          
          <div className="pt-4 border-t">
            <h3 className="text-xl font-semibold mb-2">Quick Links</h3>
            <div className="flex gap-4">
              <a href="/journal" className="text-blue-600 hover:underline font-medium">
                📖 Open Journal
              </a>
              <a href="/games" className="text-blue-600 hover:underline">
                ♟️ View All Games
              </a>
              <a href="/settings" className="text-blue-600 hover:underline">
                ⚙️ Settings
              </a>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-4">
        <h4 className="font-semibold mb-2">💡 Tip</h4>
        <p className="text-sm">
          Keep your journal open while playing on Chess.com. After each move, record what you were thinking. 
          This helps you understand the gap between your thought process and optimal play!
        </p>
      </div>
    </div>
  )
}
