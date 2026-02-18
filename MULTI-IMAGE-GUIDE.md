# Multi-Image Support Implementation

Your Chess Diary now supports multiple images per journal entry!

## ✨ Features

### Add Multiple Images
- **Paste**: Ctrl+V to paste images from clipboard (paste multiple times)
- **Upload**: Click "+ Add Image" button to select multiple files at once
- **Mix**: Combine pasted and uploaded images in the same entry

### Manage Images
- **Preview**: Grid layout shows all images with thumbnails
- **Remove**: Hover over any image and click ✕ to remove it
- **Numbered**: Images show their position (1, 2, 3...)
- **Responsive**: 2-3 columns on desktop, 2 on mobile

### Display in Entries
- **Single image**: Full-size display (max-width)
- **Multiple images**: Grid layout with uniform sizing
- **Backward compatible**: Old entries with single images still work

### Word Export
- **All images included**: Every image exports to Word document
- **Proper sizing**: 400x300px transformation
- **Error handling**: Gracefully handles image processing errors

## 📦 Files Updated

1. **`journal-page-multi-image.tsx`** → `app/journal/page.tsx`
   - Multi-image state management
   - Grid display for images
   - Upload button + paste support
   - Backward compatibility with legacy single images

2. **`export-route-multi-images.ts`** → `app/api/journal/export/route.ts`
   - Exports all images to Word
   - Supports both new array and legacy format

3. **`migrate-images-to-array.ts`** → `app/api/debug/migrate-images/route.ts`
   - One-time migration script
   - Converts old `image` → `images[]`

## 🚀 Migration Steps

### 1. Deploy New Code
Upload all three files to their respective locations.

### 2. Run Migration (One-Time)
Open browser (logged in), press F12, run:
```javascript
fetch('/api/debug/migrate-images', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' }
}).then(r => r.json()).then(console.log)
```

Response:
```json
{
  "success": true,
  "migratedCount": 15,
  "message": "Migrated 15 entry/entries to multi-image format"
}
```

### 3. Verify
- Check existing entries - should still display fine
- Create new entry with multiple images
- Export to Word - verify all images included

## 💾 Database Changes

### Before (Legacy)
```typescript
{
  id: 1,
  content: "My thought",
  image: "data:image/png;base64,..."  // Single image
}
```

### After (New)
```typescript
{
  id: 1,
  content: "My thought",
  images: [  // Array of images
    "data:image/png;base64,...",
    "data:image/jpeg;base64,...",
    "data:image/png;base64,..."
  ]
}
```

### Backward Compatibility
The code supports BOTH formats:
- New entries: Use `images[]` array
- Old entries: Still work with `image` field
- Migration script: Converts old → new (optional but recommended)

## 🎨 UI Changes

### Entry Form
**Before:**
- Single image display
- Replace on paste

**After:**
- Grid of thumbnails
- "+ Add Image" button
- Numbered images (1, 2, 3...)
- Individual remove buttons
- Paste adds to collection

### Journal Display
**Before:**
- One image per entry

**After:**
- Smart grid (1 col for 1 image, 2-3 cols for multiple)
- Uniform sizing for multiple images
- Maintains legacy single-image full-size display

## 🐛 Troubleshooting

**Images not showing after migration?**
- Refresh the page
- Check browser console for errors
- Verify migration ran successfully

**Can't add more than one image?**
- Make sure you deployed `journal-page-multi-image.tsx`
- Clear browser cache
- Check that `handleImageUpload` and `handleImagePaste` are updated

**Word export missing images?**
- Deploy `export-route-multi-images.ts`
- Check terminal for image processing errors
- Verify images are valid base64

**Old entries broken?**
- Code has backward compatibility
- Both `image` and `images` fields are supported
- Migration is optional

## ✅ Testing Checklist

- [ ] Paste single image - works
- [ ] Paste multiple images - all appear
- [ ] Upload button - can select multiple files
- [ ] Remove image - removes correct one
- [ ] Edit entry with images - loads properly
- [ ] Create entry with 3+ images - grid displays correctly
- [ ] Export to Word - all images included
- [ ] Old entries - still display single image
- [ ] Migration script - converts old entries

## 🎯 Future Enhancements (Optional)

- Drag to reorder images
- Click image to view full-size
- Image captions
- Compress images to reduce size
- Image gallery view
- Direct camera capture

Enjoy your multi-image journal entries! 📸📝
