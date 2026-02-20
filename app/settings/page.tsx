'use client';

import { useEffect, useState } from 'react';

interface Settings {
  chesscom_username?: string;
  analysis_depth?: string;
  ai_analysis_verbosity?: 'brief' | 'concise' | 'detailed' | 'extensive';
  ai_model?: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setSettings(data.settings || {});
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    setSaveMessage('');
    
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (response.ok) {
        setSaveMessage('✓ Settings saved successfully!');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('✗ Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setSaveMessage('✗ Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = (key: keyof Settings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
        {/* Chess.com Username */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Chess.com Username
          </label>
          <input
            type="text"
            value={settings.chesscom_username || ''}
            onChange={(e) => updateSetting('chesscom_username', e.target.value)}
            placeholder="your_username"
            className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
          />
          <p className="text-xs text-gray-500 mt-1">
            Used to fetch your games and determine your color in games
          </p>
        </div>

        {/* Analysis Depth */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Engine Analysis Depth
          </label>
          <select
            value={settings.analysis_depth || '10'}
            onChange={(e) => updateSetting('analysis_depth', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="8">8 (Fast)</option>
            <option value="10">10 (Default)</option>
            <option value="12">12 (Balanced)</option>
            <option value="15">15 (Deep)</option>
            <option value="18">18 (Very Deep)</option>
            <option value="20">20 (Maximum)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Higher depth = more accurate but slower analysis. Depth 10-12 is recommended.
          </p>
        </div>

        {/* AI Analysis Verbosity */}
        <div>
          <label className="block text-sm font-medium mb-2">
            AI Analysis Verbosity
          </label>
          <select
            value={settings.ai_analysis_verbosity || 'detailed'}
            onChange={(e) => updateSetting('ai_analysis_verbosity', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="brief">Brief (1-2 sentences)</option>
            <option value="concise">Concise (2-3 sentences)</option>
            <option value="detailed">Detailed (2-3 paragraphs) - Recommended</option>
            <option value="extensive">Extensive (3-4 paragraphs)</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            How much detail should AI provide when analyzing your thinking?
          </p>
          
          {/* Preview of verbosity levels */}
          <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded text-sm">
            <p className="font-medium mb-2">Preview:</p>
            {settings.ai_analysis_verbosity === 'brief' && (
              <p className="text-gray-600 dark:text-gray-400 italic">
                "Your castling plan was solid. The engine prefers d4 for more central control."
              </p>
            )}
            {settings.ai_analysis_verbosity === 'concise' && (
              <p className="text-gray-600 dark:text-gray-400 italic">
                "Your reasoning to castle was sound for king safety. However, with no immediate threats, d4 would gain more central space and activate your pieces more effectively."
              </p>
            )}
            {settings.ai_analysis_verbosity === 'detailed' && (
              <div className="text-gray-600 dark:text-gray-400 italic space-y-2">
                <p>
                  "Your reasoning to castle kingside was sound - king safety is a fundamental principle..."
                </p>
                <p>
                  "However, you may have overlooked that your center is still fluid..."
                </p>
                <p>
                  "The key learning point: before castling, always ask 'what is my opponent threatening?'..."
                </p>
              </div>
            )}
            {settings.ai_analysis_verbosity === 'extensive' && (
              <div className="text-gray-600 dark:text-gray-400 italic space-y-2">
                <p>
                  "Your thought process shows good awareness of king safety principles..."
                </p>
                <p>
                  "Analyzing the position in detail: your bishop on c4 and knight on f3 create a battery..."
                </p>
                <p>
                  "The engine's preference for d4 is based on several concrete factors..."
                </p>
                <p>
                  "Pattern recognition exercise: study games where central tension is maintained before castling..."
                </p>
              </div>
            )}
          </div>
        </div>

        {/* AI Model */}
        <div>
          <label className="block text-sm font-medium mb-2">
            AI Model
          </label>
          <select
            value={settings.ai_model || 'claude-sonnet-4-6'}
            onChange={(e) => updateSetting('ai_model', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
          >
            <optgroup label="Claude 4 (Latest)">
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6 - Recommended</option>
              <option value="claude-opus-4-6">Claude Opus 4.6 - Most capable</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 - Fast & cheap</option>
            </optgroup>
            <optgroup label="Claude 3.5">
              <option value="claude-3-5-sonnet-20240620">Claude 3.5 Sonnet (Jun 2024)</option>
            </optgroup>
            <optgroup label="Claude 3">
              <option value="claude-3-opus-20240229">Claude 3 Opus</option>
              <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
              <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
            </optgroup>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Choose the AI model for analyzing your chess thinking. Claude Sonnet 4.6 offers the best balance.
          </p>
          <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs">
            <strong>📚 Latest models:</strong> Check{' '}
            <a 
              href="https://platform.claude.com/docs/en/about-claude/models/overview" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              Anthropic's Models Page
            </a>
            {' '}for updates and pricing.
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-4 pt-4 border-t">
          <button
            onClick={saveSettings}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          
          {saveMessage && (
            <span className={`text-sm ${saveMessage.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
              {saveMessage}
            </span>
          )}
        </div>
      </div>

      {/* Additional Info */}
      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <h3 className="font-semibold mb-2">💡 Tips</h3>
        <ul className="text-sm space-y-1 text-gray-700 dark:text-gray-300">
          <li>• Start with <strong>Detailed</strong> verbosity to get comprehensive feedback</li>
          <li>• Increase analysis depth for critical games, but expect longer wait times</li>
          <li>• Your Chess.com username is needed to fetch games and determine your color</li>
        </ul>
      </div>
    </div>
  );
}
