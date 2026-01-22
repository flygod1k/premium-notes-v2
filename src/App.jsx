import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

function App() {
  const [session, setSession] = useState(null)
  
  // ✅ FIX 1: Initialize State directly from LocalStorage (Survives App Close/Safari Clear)
  const [notes, setNotes] = useState(() => {
    const saved = localStorage.getItem('MY_NOTES_CACHE')
    return saved ? JSON.parse(saved) : []
  })

  // ✅ FIX 2: Initialize Categories from LocalStorage
  const [categories, setCategories] = useState(() => {
    const saved = localStorage.getItem('MY_CATS_CACHE')
    return saved ? JSON.parse(saved) : ['General', 'Work', 'Device Repair', 'Football', 'Personal']
  })

  const [content, setContent] = useState('')
  const [category, setCategory] = useState('General')
  const [imageFile, setImageFile] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [editingNote, setEditingNote] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  
  // Security & History States
  const [notePassword, setNotePassword] = useState('')
  const [unlockedNotes, setUnlockedNotes] = useState([])
  const [unlockInput, setUnlockInput] = useState('')
  const [previewImage, setPreviewImage] = useState(null)
  const [historyNotes, setHistoryNotes] = useState([])
  const [viewingHistoryId, setViewingHistoryId] = useState(null)
  
  // 🔄 Categories Initial State
  const [newCatName, setNewCatName] = useState('')
  const [isManagingCats, setIsManagingCats] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [activityLogs, setActivityLogs] = useState([])
  const [showLogs, setShowLogs] = useState(false)
  const [view, setView] = useState('login')
  const [viewingNote, setViewingNote] = useState(null)
  
  // 🌐 Internet Status
  const [isOnline, setIsOnline] = useState(navigator.onLine)

  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', handleStatusChange)
    window.addEventListener('offline', handleStatusChange)
    return () => {
      window.removeEventListener('online', handleStatusChange)
      window.removeEventListener('offline', handleStatusChange)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'PASSWORD_RECOVERY') setView('reset')
    })
  }, [])

  useEffect(() => {
    // Only fetch from Supabase if we are ONLINE and have a Session
    if (session && isOnline) {
      fetchNotes()
      fetchCategories()
    }
  }, [session, showTrash, isOnline]) // Re-fetch when these change

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    }).replace(',', ' •');
  };

  // 🔄 FIXED: Default Categories နှင့် Database Categories ကို ပေါင်းစည်းခြင်း
  async function fetchCategories() {
    // Don't fetch if offline, use existing state
    if (!navigator.onLine) return;

    const { data } = await supabase.from('categories').select('name').order('name')
    const systemDefaults = ['General', 'Work', 'Device Repair', 'Football', 'Personal']
    
    if (data) {
      const dbCats = data.map(c => c.name)
      // Array.from(new Set(...)) ကိုသုံးပြီး Duplicate များကို ဖယ်ရှားကာ ပေါင်းစည်းသည်
      const combined = Array.from(new Set([...systemDefaults, ...dbCats]))
      setCategories(combined)
      // ✅ SAVE TO CACHE
      localStorage.setItem('MY_CATS_CACHE', JSON.stringify(combined))
    } else {
      setCategories(systemDefaults)
    }
  }

  const addCategory = async () => {
    if (!isOnline) return alert("Offline: Cannot add categories.")

    if (newCatName && !categories.includes(newCatName)) {
      setLoading(true)
      const { error } = await supabase.from('categories').insert([{ name: newCatName, user_id: session.user.id }])
      if (error) alert(error.message)
      else {
        setNewCatName('')
        fetchCategories()
      }
      setLoading(false)
    }
  }

  const deleteCategory = async (catToDelete) => {
    if (!isOnline) return alert("Offline: Cannot delete categories.")

    const systemDefaults = ['General', 'Work', 'Device Repair', 'Football', 'Personal']
    if (systemDefaults.includes(catToDelete)) return alert("Default Categories များကို ဖျက်၍မရပါ")
    
    if (confirm(`Delete category "${catToDelete}"?`)) {
      setLoading(true)
      const { error } = await supabase.from('categories').delete().eq('name', catToDelete)
      if (error) alert(error.message)
      else fetchCategories()
      setLoading(false)
    }
  }

  async function logActivity(noteId, action, details) {
    if (!isOnline) return;
    await supabase.from('activity_logs').insert([{
      note_id: noteId, action, details, user_id: session.user.id
    }])
  }

  async function fetchLogs() {
    if (!isOnline) return alert("Logs require internet.")
    const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(20)
    setActivityLogs(data || [])
    setShowLogs(true)
  }

  async function fetchNotes() {
    if (!navigator.onLine) return; // If offline, keep showing what we have in cache

    const { data } = await supabase.from('notes')
      .select('*')
      .eq('is_trash', showTrash)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    
    if (data) {
      setNotes(data || [])
      // ✅ SAVE TO CACHE (This key changes based on Trash/Not Trash to allow simple switching)
      // Ideally we cache everything, but to keep your logic:
      if (!showTrash) {
          // If we are viewing main notes, save them to the MAIN cache
          localStorage.setItem('MY_NOTES_CACHE', JSON.stringify(data))
      }
    }
  }

  async function togglePin(note) {
    if (!isOnline) return alert("Offline: Cannot pin.")
    const { error } = await supabase.from('notes').update({ is_pinned: !note.is_pinned }).eq('id', note.id)
    if (error) alert(error.message)
    else {
      logActivity(note.id, !note.is_pinned ? 'Pinned' : 'Unpinned', `Status updated`)
      fetchNotes()
    }
  }

  async function fetchHistory(noteId) {
    if (!isOnline) return alert("History requires internet.")
    const { data } = await supabase.from('note_history').select('*').eq('note_id', noteId).order('created_at', { ascending: false })
    setHistoryNotes(data || [])
    setViewingHistoryId(noteId)
  }

  const handleLogout = async () => {
    try {
      // ✅ CLEAR CACHE ON LOGOUT so next user doesn't see your notes
      localStorage.removeItem('MY_NOTES_CACHE');
      localStorage.removeItem('MY_CATS_CACHE');
      
      const { error } = await supabase.auth.signOut()
      if (error) { localStorage.clear(); window.location.reload(); }
    } catch (err) { localStorage.clear(); window.location.reload(); }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    if (!isOnline) return alert("Offline.")
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}`, 
    })
    if (error) alert(error.message)
    else alert("Reset link sent to your email.")
    setLoading(false)
  }

  const handleUpdatePassword = async (e) => {
    e.preventDefault()
    if (!isOnline) return alert("Offline.")
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: password })
    if (error) alert(error.message)
    else { alert("Password updated."); setView('login'); }
    setLoading(false)
  }

  const exportToPDF = async () => {
    const element = document.getElementById('notes-grid');
    if (!element) return;
    try {
      setLoading(true); window.scrollTo(0, 0);
      const canvas = await html2canvas(element, {
        useCORS: true, scale: 3, backgroundColor: "#020617",
        onclone: (clonedDoc) => {
          const styleTags = clonedDoc.getElementsByTagName("style");
          const linkTags = clonedDoc.querySelectorAll('link[rel="stylesheet"]');
          Array.from(styleTags).forEach(tag => tag.remove());
          Array.from(linkTags).forEach(tag => tag.remove());
          const clonedGrid = clonedDoc.getElementById('notes-grid');
          if (clonedGrid) {
            clonedGrid.style.cssText = `display: grid !important; grid-template-columns: repeat(2, 1fr) !important; gap: 20px !important; width: 1200px !important; background-color: #020617 !important; padding: 40px !important; color: white !important;`;
            const cards = clonedGrid.children;
            for (let card of cards) {
              card.style.cssText = "background-color: #0f172a !important; border-radius: 24px !important; border: 2px solid #1e293b !important; overflow: hidden !important; padding: 20px !important;";
              const p = card.querySelector('p');
              if (p) p.style.cssText = "font-size: 20px !important; color: #e2e8f0 !important; font-family: sans-serif !important; line-height: 1.6 !important;";
            }
          }
        }
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), (canvas.height * pdf.internal.pageSize.getWidth()) / canvas.width);
      pdf.save(`Premium-Notes-${new Date().getTime()}.pdf`);
    } catch (error) { alert("PDF Error: " + error.message); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!isOnline) return alert("Cannot login while offline.")
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) alert(error.message)
  }

  const handleSignUp = async (e) => {
    e.preventDefault()
    if (!isOnline) return alert("Cannot signup while offline.")
    const { error } = await supabase.auth.signUp({ email, password })
    if (error) alert(error.message)
    else alert("Check your email for confirmation.")
  }

  const renderContent = (text) => {
    const phoneRegex = /(09\d{8,9}|\+959\d{8,9})/g;
    const parts = text.split(phoneRegex);
    return parts.map((part, i) => 
      phoneRegex.test(part) ? (
        <a key={i} href={`tel:${part.replace(/\s+/g, '')}`} className="text-emerald-400 underline font-bold">{part}</a>
      ) : part
    );
  };

  async function handleSubmit(e) {
    e.preventDefault()
    
    // 🛑 Offline Guard
    if (!isOnline) return alert("You are OFFLINE. Cannot save edits.")

    if (!content.trim()) return
    setLoading(true)
    try {
      let uploadedImageUrl = editingNote?.image_url || null
      if (imageFile) {
        const fileName = `${Date.now()}.${imageFile.name.split('.').pop()}`
        await supabase.storage.from('note-images').upload(fileName, imageFile)
        const { data: { publicUrl } } = supabase.storage.from('note-images').getPublicUrl(fileName)
        uploadedImageUrl = publicUrl
      }
      const noteData = { 
        content, category, image_url: uploadedImageUrl, 
        user_id: session.user.id, password: notePassword || null,
        updated_at: new Date().toISOString()
      }
      if (editingNote) {
        if (confirm("Save previous version?")) {
          await supabase.from('note_history').insert([{
            note_id: editingNote.id, content: editingNote.content,
            category: editingNote.category, image_url: editingNote.image_url,
            user_id: session.user.id
          }])
        }
        await supabase.from('notes').update(noteData).eq('id', editingNote.id)
        logActivity(editingNote.id, 'Edited', `In ${category}`)
        setEditingNote(null)
      } else {
        const { data } = await supabase.from('notes').insert([noteData]).select()
        if (data) logActivity(data[0].id, 'Created', `In ${category}`)
      }
      setContent(''); setImageFile(null); setNotePassword(''); fetchNotes()
    } catch (err) { alert(err.message) } finally { setLoading(false) }
  }

  async function moveToTrash(id) {
    if (!isOnline) return alert("Offline: Cannot trash.")
    if (confirm('Move to Trash?')) {
      await supabase.from('notes').update({ is_trash: true }).eq('id', id)
      logActivity(id, 'Deleted', 'To Trash')
      fetchNotes()
    }
  }

  async function restoreFromTrash(id) {
    if (!isOnline) return alert("Offline: Cannot restore.")
    await supabase.from('notes').update({ is_trash: false }).eq('id', id)
    logActivity(id, 'Restored', 'From Trash')
    fetchNotes()
  }

  async function permanentDelete(id) {
    if (!isOnline) return alert("Offline: Cannot delete.")
    if (confirm('Permanently delete?')) {
      await supabase.from('notes').delete().eq('id', id)
      fetchNotes()
    }
  }

  async function undoEdit(noteId) {
    if (!isOnline) return alert("Offline: Cannot undo.")
    const { data: latestHistory } = await supabase.from('note_history')
      .select('*').eq('note_id', noteId).order('created_at', { ascending: false }).limit(1).single()
    if (latestHistory) {
      if (confirm("Undo changes?")) {
        await supabase.from('notes').update({
          content: latestHistory.content, category: latestHistory.category,
          image_url: latestHistory.image_url, updated_at: new Date().toISOString()
        }).eq('id', noteId)
        logActivity(noteId, 'Restored', 'Undo Applied')
        fetchNotes()
      }
    } else { alert("No history found."); }
  }

  const startEdit = (note) => {
    setEditingNote(note); setContent(note.content);
    setCategory(note.category); setNotePassword(note.password || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const handleUnlock = (noteId, correctPassword) => {
    if (unlockInput === correctPassword) {
      setUnlockedNotes([...unlockedNotes, noteId]); setUnlockInput('');
    } else { alert("Wrong PIN"); }
  }

  const filteredNotes = notes.filter(note => {
    const matchesSearch = note.content.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'All' || note.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // ✅ OFFLINE BYPASS: If no session, but we have notes in cache, show the app!
  const hasLocalNotes = notes.length > 0;

  if (!session && !hasLocalNotes && view !== 'forgot' && view !== 'reset') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-slate-200 text-center uppercase font-black">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl animate-in zoom-in duration-300">
          <h1 className="text-3xl text-emerald-400 mb-6 tracking-tighter">Premium Notes</h1>
          <form className="space-y-4">
            <input className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            <button onClick={handleLogin} disabled={!isOnline} className={`w-full py-3 rounded-xl font-bold ${isOnline ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-400 cursor-not-allowed'}`}>
                {isOnline ? 'Login' : 'Offline (No Data)'}
            </button>
            <div className="flex justify-between items-center mt-4">
              <button type="button" onClick={() => setView('forgot')} className="text-slate-500 text-[10px] underline uppercase">Forgot Password?</button>
              <button type="button" onClick={handleSignUp} className="text-emerald-500 text-[10px] underline uppercase">Create Account</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  if (view === 'forgot' || view === 'reset') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6 text-slate-200 text-center uppercase font-black">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-2xl animate-in zoom-in duration-300">
          <h1 className="text-3xl text-emerald-400 mb-6 tracking-tighter">
            {view === 'forgot' ? 'Forgot Password' : 'New Password'}
          </h1>
          {view === 'forgot' ? (
            <form className="space-y-4">
              <input className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none" placeholder="Your Email" value={email} onChange={e => setEmail(e.target.value)} />
              <button onClick={handleForgotPassword} disabled={loading || !isOnline} className="w-full bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold">{loading ? 'Sending...' : 'Send Link'}</button>
              <button type="button" onClick={() => setView('login')} className="text-slate-500 text-[10px] underline uppercase block mx-auto">Back to Login</button>
            </form>
          ) : (
            <form className="space-y-4">
              <input className="w-full bg-slate-800 border border-slate-700 p-3 rounded-xl outline-none" type="password" placeholder="New Password" value={password} onChange={e => setPassword(e.target.value)} />
              <button onClick={handleUpdatePassword} disabled={loading || !isOnline} className="w-full bg-emerald-500 text-slate-950 py-3 rounded-xl font-bold">{loading ? 'Updating...' : 'Update Password'}</button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-12">
      <div className="max-w-5xl mx-auto">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 bg-slate-900/40 backdrop-blur-xl p-4 md:p-6 rounded-3xl border border-slate-800 gap-4 shadow-xl relative overflow-hidden">
          
          {/* OFFLINE BANNER */}
          {!isOnline && (
            <div className="absolute top-0 left-0 w-full bg-red-600/20 text-red-400 text-center text-[10px] font-bold py-1 uppercase tracking-widest border-b border-red-500/50">
              ⚠️ Offline Mode - View Only
            </div>
          )}

          <div className="w-full sm:w-auto mt-4 sm:mt-0">
            <h1 className="text-xl md:text-2xl font-black text-emerald-400 uppercase tracking-tighter">Premium Notes v2</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest truncate max-w-[200px] sm:max-w-none">
                {session?.user?.email || "Offline Mode"}
            </p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
            <button onClick={fetchLogs} className="bg-slate-800 text-slate-400 px-4 py-2 rounded-full text-[10px] font-bold border border-slate-700">LOGS</button>
            <button onClick={() => setShowTrash(!showTrash)} className={`px-4 py-2 rounded-full text-[10px] font-bold border ${showTrash ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
              {showTrash ? 'NOTES' : 'TRASH'}
            </button>
            <button onClick={exportToPDF} className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/50 px-4 py-2 rounded-full text-[10px] font-bold">PDF</button>
            <button onClick={handleLogout} className="bg-slate-800 text-slate-400 px-4 py-2 rounded-full text-[10px] font-bold border border-slate-700">LOGOUT</button>
          </div>
        </header>

        <div className="mb-6">
          <button onClick={() => setIsManagingCats(!isManagingCats)} className="text-[10px] bg-slate-800 text-emerald-400 px-3 py-1 rounded-lg border border-slate-700 uppercase font-bold">
            {isManagingCats ? '✖ Close Manager' : '⚙ Manage Categories'}
          </button>
          {isManagingCats && (
            <div className="mt-4 p-4 bg-slate-900 rounded-2xl border border-slate-800">
              <div className="flex gap-2 mb-4">
                <input className="flex-1 bg-slate-800 border border-slate-700 p-2 rounded-lg text-xs outline-none" placeholder="New Cat" value={newCatName} onChange={e => setNewCatName(e.target.value)} />
                <button onClick={addCategory} disabled={loading} className="bg-emerald-500 text-slate-950 px-4 py-2 rounded-lg text-xs font-bold">ADD</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <div key={cat} className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700 text-[10px]">
                    <span className="font-bold">{cat}</span>
                    {/* Default Cats များအား ဖျက်၍မရအောင် ကန့်သတ်ခြင်း */}
                    {!['General', 'Work', 'Device Repair', 'Football', 'Personal'].includes(cat) && 
                      <button onClick={() => deleteCategory(cat)} className="text-red-500 font-black">×</button>
                    }
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {!showTrash && (
          <>
            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <input className="bg-slate-900 border border-slate-800 p-4 rounded-2xl outline-none" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              <select className="bg-slate-900 border border-slate-800 p-4 rounded-2xl outline-none" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                <option value="All">All Categories</option>
                {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>
            {/* Input Form disabled if offline */}
            <form onSubmit={handleSubmit} className={`mb-8 bg-slate-900 p-6 rounded-3xl border border-slate-800 shadow-2xl ${!isOnline ? 'opacity-50 pointer-events-none' : ''}`}>
              <textarea className="w-full bg-slate-800 p-4 rounded-xl outline-none mb-4 min-h-[100px]" placeholder={isOnline ? "Write a note..." : "Offline: Read Only Mode"} value={content} onChange={(e) => setContent(e.target.value)} disabled={!isOnline} />
              <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-3 items-center">
                  <select className="bg-slate-800 p-2.5 rounded-xl text-xs outline-none border border-slate-700" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!isOnline}>
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <input type="password" placeholder="PIN" className="bg-slate-800 p-2.5 rounded-xl text-[10px] outline-none border border-slate-700 w-24" value={notePassword} onChange={(e) => setNotePassword(e.target.value)} disabled={!isOnline} />
                  <label className="cursor-pointer flex items-center gap-2 bg-emerald-500/10 px-4 py-2.5 rounded-xl border border-emerald-500/30">
                    <span className="text-[10px] font-bold text-emerald-400 uppercase">{imageFile ? "OK" : "PHOTO"}</span>
                    <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} className="hidden" disabled={!isOnline} />
                  </label>
                </div>
                <button type="submit" disabled={loading || !isOnline} className="bg-emerald-500 text-slate-950 font-black px-10 py-2.5 rounded-xl text-xs uppercase shadow-lg">
                  {loading ? '...' : (editingNote ? 'Update' : 'Post')}
                </button>
              </div>
            </form>
          </>
        )}

        <div id="notes-grid" className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6 pb-20 items-start">
          {filteredNotes.map(note => {
            const isLocked = note.password && !unlockedNotes.includes(note.id);
            return (
              <div key={note.id} className={`bg-slate-900 border rounded-2xl overflow-hidden flex flex-col hover:border-emerald-500/30 shadow-xl transition-all ${note.is_pinned ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-slate-800'}`}>
                {isLocked ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-4 text-center space-y-3">
                    <p className="text-[8px] text-slate-500 font-bold uppercase">Locked</p>
                    <input type="password" placeholder="PIN" className="w-full bg-slate-800 border border-slate-700 p-2 rounded-lg text-xs text-center outline-none" onChange={(e) => setUnlockInput(e.target.value)} />
                    <button onClick={() => handleUnlock(note.id, note.password)} className="w-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold py-2 rounded-lg">UNLOCK</button>
                  </div>
                ) : (
                  <>
                    {note.image_url && <img src={note.image_url} crossOrigin="anonymous" onClick={() => setPreviewImage(note.image_url)} className="w-full h-32 md:h-48 object-cover cursor-zoom-in" />}
                    <div className="p-3 md:p-5 flex-1 flex flex-col">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full uppercase font-black">{note.category}</span>
                        <div className="flex gap-2 items-center">
                          {!showTrash && (
                            <>
                              <button onClick={() => togglePin(note)} className={`text-[12px] transition-all hover:scale-125 ${note.is_pinned ? 'grayscale-0' : 'grayscale opacity-30 hover:opacity-100'}`}>📌</button>
                              <button onClick={() => fetchHistory(note.id)} className="text-[10px] text-slate-600 hover:text-emerald-400">⏳</button>
                              <button onClick={() => undoEdit(note.id)} className="text-[10px] text-slate-600 hover:text-emerald-400">🔄</button>
                            </>
                          )}
                        </div>
                      </div>
                      <p onClick={() => setViewingNote(note)} className="text-slate-300 mb-4 text-xs md:text-sm leading-relaxed whitespace-pre-wrap flex-1 line-clamp-4 overflow-hidden cursor-pointer hover:text-white transition-colors">
                        {renderContent(note.content)}
                      </p>
                      <div className="mb-4 text-[7px] text-slate-600 uppercase font-medium">
                        <p>In: {formatDate(note.created_at)}</p>
                        <p>Edit: {formatDate(note.updated_at)}</p>
                      </div>
                      <div className="flex justify-between items-center border-t border-slate-800/50 pt-3 mt-auto">
                        {showTrash ? (
                          <>
                            <button onClick={() => restoreFromTrash(note.id)} className="text-emerald-500 text-[10px] font-bold uppercase">Restore</button>
                            <button onClick={() => permanentDelete(note.id)} className="text-red-500 text-[10px] font-bold uppercase">Delete</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(note)} className="text-emerald-500 text-[10px] font-bold uppercase">Edit</button>
                            <button onClick={() => moveToTrash(note.id)} className="text-slate-700 hover:text-red-500 text-[10px] font-bold uppercase">Trash</button>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 📖 FULL VIEW MODAL */}
      {viewingNote && (
        <div className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md overflow-hidden" onClick={() => setViewingNote(null)}>
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl max-h-[85vh] rounded-3xl flex flex-col shadow-2xl animate-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full uppercase font-black tracking-widest">{viewingNote.category}</span>
              <button onClick={() => setViewingNote(null)} className="bg-slate-800 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-8">
              {viewingNote.image_url && <img src={viewingNote.image_url} crossOrigin="anonymous" className="w-full h-auto max-h-[400px] object-cover rounded-2xl mb-6 shadow-lg border border-slate-800" />}
              <p className="text-slate-200 text-sm md:text-base whitespace-pre-wrap leading-relaxed">
                {renderContent(viewingNote.content)}
              </p>
              <div className="mt-8 pt-6 border-t border-slate-800 flex flex-col gap-1">
                <p className="text-[9px] text-slate-500 uppercase tracking-widest">Date Created: {formatDate(viewingNote.created_at)}</p>
                <p className="text-[9px] text-emerald-500/50 uppercase tracking-widest">Last Modified: {formatDate(viewingNote.updated_at)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals for History, Logs, Image Preview */}
      {viewingHistoryId && (
        <div className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md overflow-hidden" onClick={() => setViewingHistoryId(null)}>
          <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl max-h-[80vh] rounded-3xl flex flex-col shadow-2xl animate-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900 sticky top-0">
              <h2 className="text-emerald-400 font-black uppercase text-sm tracking-widest">Version History</h2>
              <button onClick={() => setViewingHistoryId(null)} className="bg-slate-800 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {historyNotes.map(history => (
                <div key={history.id} className="p-4 rounded-2xl border border-slate-800 bg-slate-800/50">
                  <p className="text-[9px] text-emerald-400 font-bold mb-1 uppercase tracking-widest">Saved: {formatDate(history.created_at)}</p>
                  <p className="text-slate-300 text-xs whitespace-pre-wrap">{history.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showLogs && (
        <div className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center p-4 backdrop-blur-md overflow-hidden" onClick={() => setShowLogs(false)}>
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg max-h-[70vh] rounded-3xl flex flex-col shadow-2xl animate-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <h2 className="text-emerald-400 font-black uppercase text-sm tracking-widest tracking-widest">📜 Activity Log</h2>
              <button onClick={() => setShowLogs(false)} className="bg-slate-800 text-white px-4 py-2 rounded-full text-[10px] font-bold uppercase">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {activityLogs.map(log => (
                <div key={log.id} className="border-b border-slate-800/50 pb-4">
                  <p className="text-[9px] font-bold uppercase text-emerald-400">{log.action} • <span className="text-slate-600 font-medium">{formatDate(log.created_at)}</span></p>
                  <p className="text-slate-300 text-[10px] mt-1 tracking-tight">{log.details}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewImage && (
        <div className="fixed inset-0 z-[120] bg-black/95 flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} className="max-h-full max-w-full object-contain rounded-lg animate-in zoom-in duration-300 shadow-2xl" />
        </div>
      )}
    </div>
  )
}

export default App