'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Backup {
  url: string;
  pathname: string;
  uploadedAt: string;
  size: number;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/admin/check').then(r => r.json()).then(d => {
      setIsAdmin(d.isAdmin);
      if (d.isAdmin) loadBackups();
      else setLoading(false);
    }).catch(() => { setIsAdmin(false); setLoading(false); });
  }, []);

  const loadBackups = async () => {
    try {
      const response = await fetch('/api/backups/list');
      const data = await response.json();
      setBackups(data.backups || []);
    } catch (error) {
      console.error('Error loading backups:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (backupUrl: string, backupDate: string) => {
    if (!confirm(`Are you sure you want to restore from backup dated ${new Date(backupDate).toLocaleString()}? This will replace all current data.`)) {
      return;
    }

    setRestoring(true);
    try {
      const response = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupUrl }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ Restore successful! Data restored from ${new Date(data.restoredFrom).toLocaleString()}`);
        window.location.href = '/';
      } else {
        alert(`❌ Restore failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Restore error:', error);
      alert('❌ Restore failed. Check console for details.');
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="container mx-auto">
          <p>Loading backups...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="container mx-auto">
          <p className="text-gray-600 dark:text-gray-400">Admin access required to view backups.</p>
          <Link href="/" className="text-blue-600 hover:underline dark:text-blue-400 mt-4 inline-block">← Back to Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="container mx-auto max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold dark:text-white">Backup History</h1>
          <Link 
            href="/"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            ← Back to Home
          </Link>
        </div>

        {backups.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <p className="text-gray-600 dark:text-gray-400">
              No backups found yet. First automated backup will run at 2 AM UTC daily.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              You can also trigger a manual backup from the Settings page.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {backups.map((backup) => (
              <div 
                key={backup.url} 
                className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 rounded-lg"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {backup.pathname.replace('backups/', '')}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {new Date(backup.uploadedAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      Size: {(backup.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={backup.url}
                      download
                      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
                    >
                      📥 Download
                    </a>
                    <button
                      onClick={() => handleRestore(backup.url, backup.uploadedAt)}
                      disabled={restoring}
                      className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {restoring ? '⏳ Restoring...' : '🔄 Restore'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
            ℹ️ Backup Information
          </h3>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <li>• Automated backups run daily at 2 AM UTC</li>
            <li>• Backups are retained for 30 days</li>
            <li>• You can download any backup to your computer</li>
            <li>• Restoring replaces all current data with the backup</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
