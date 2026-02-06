'use client';

import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [username, setUsername] = useState('');
  const [exportFont, setExportFont] = useState('Calibri');
  const [exportFontSize, setExportFontSize] = useState('11');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setUsername(data.settings?.chesscom_username || '');
      setExportFont(data.settings?.export_font || 'Calibri');
      setExportFontSize(data.settings?.export_font_size || '11');
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      // Save all settings
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'chesscom_username', value: username }),
      });
      
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'export_font', value: exportFont }),
      });
      
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'export_font_size', value: exportFontSize }),
      });

      if (response.ok) {
        setMessage('Settings saved successfully!');
      } else {
        setMessage('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setMessage('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading settings...</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">Settings</h2>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 max-w-2xl">
        <form onSubmit={saveSettings} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Chess.com Username
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
              placeholder="Enter your Chess.com username"
              required
            />
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              This username will be used to fetch your games from Chess.com
            </p>
          </div>
          
          <div>
            <label htmlFor="exportFont" className="block text-sm font-medium mb-2">
              Word Export Font
            </label>
            <select
              id="exportFont"
              value={exportFont}
              onChange={(e) => setExportFont(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="Calibri">Calibri</option>
              <option value="Arial">Arial</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Georgia">Georgia</option>
              <option value="Verdana">Verdana</option>
            </select>
          </div>
          
          <div>
            <label htmlFor="exportFontSize" className="block text-sm font-medium mb-2">
              Word Export Font Size
            </label>
            <select
              id="exportFontSize"
              value={exportFontSize}
              onChange={(e) => setExportFontSize(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="11">11pt</option>
              <option value="13">13pt</option>
              <option value="18">18pt</option>
            </select>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>

            {message && (
              <span className={`text-sm ${
                message.includes('success') ? 'text-green-600' : 'text-red-600'
              }`}>
                {message}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
