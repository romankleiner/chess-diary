# Post-Game Review System - User Guide

## Overview
Add retrospective analysis to your journal entries after games finish. Review your thinking with the benefit of hindsight!

## ✨ Features

### 1. Add Post-Reviews
**When:** After a game finishes  
**Where:** Any journal entry related to that game  
**How:** Click "+ Review" button on the entry

### 2. Distinct Visual Design
**Amber-colored box** with:
- 📝 Icon badge in corner
- Bold header "POST-GAME REVIEW"
- Timestamp showing days elapsed
- Separator line
- Italicized review content
- Edit/Delete buttons

### 3. Word Export
Post-reviews export as:
- **Shaded table** (amber background)
- **Bordered box** with indent
- **Bold header** with emoji
- **Timestamp** in smaller text
- **Italicized content**

## 🎯 Usage

### Adding a Review

1. **Find finished game entry**
   - Entry must be game-specific
   - Game must be completed (not in progress)

2. **Click "+ Review" button**
   - Appears next to Edit/Delete buttons
   - Only shows if no review exists yet

3. **Write your review**
   - Reflect on your thinking during that moment
   - What would you do differently?
   - What did you learn?

4. **Save**
   - Review appears in amber box below entry
   - Shows days elapsed since game

### Editing a Review

1. Click "Edit Review" in the amber box
2. Modify text
3. Click "Save Review"

### Deleting a Review

1. Click "Delete Review"
2. Confirm deletion

## 📋 Examples

### During Game
```
[2:30 PM] I'm considering Nf3 here to 
develop my knight and control e5. The 
position looks balanced.

My Move: Nf3
```

### Post-Review (Added 3 Days Later)
```
┌────────────────────────────────────┐
│ 📝 POST-GAME REVIEW                │
│ Added 3 days after game            │
│────────────────────────────────────│
│ Looking back, Nf3 was too passive. │
│ I should have played d4 to seize  │
│ the center immediately. My         │
│ opponent exploited this by playing │
│ ...c5, and I was on the back foot │
│ for the rest of the game.          │
└────────────────────────────────────┘
```

## 🎨 Visual Design

### Web UI
- **Background:** Amber-50 (light) / Amber-900/20 (dark)
- **Border:** 2px amber
- **Icon:** Badge with 📝
- **Indent:** Left margin
- **Typography:** Bold header, italic content

### Word Document
- **Shaded table:** 15% amber fill
- **Borders:** Amber color
- **Indent:** 0.5 inch from left
- **Header:** Bold with emoji
- **Content:** Italicized

## 🚀 Future: AI Reviews

**Coming soon:**
- "Generate AI Review" button
- Auto-analyze your thinking
- Compare with engine analysis
- Suggest improvements
- Edit AI suggestions before saving

## 💡 Tips

### Good Review Questions
- What was I thinking?
- What did I miss?
- What pattern should I remember?
- What would I do differently?
- What did I learn?

### When to Add Reviews
- **Same day:** Fresh memory
- **Next day:** After sleeping on it
- **Few days later:** With emotional distance
- **After analysis:** Using engine feedback

### Multiple Entries Per Game
Each entry can have its own review!
- Entry 1 (move 12): Review opening choice
- Entry 2 (move 25): Review middlegame plan
- Entry 3 (move 40): Review endgame technique

## 🔒 Data Structure

```typescript
{
  id: 12345,
  content: "My original thoughts...",
  myMove: "Nf3",
  postReview: {
    content: "Looking back...",
    timestamp: "2026-02-21T10:30:00Z",
    type: "manual"  // or "ai" in future
  }
}
```

Enjoy your post-game insights! 📝♟️
