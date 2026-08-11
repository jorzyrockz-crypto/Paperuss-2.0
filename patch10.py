import codecs
with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Make tblSort capture history
sort_history_start = """
    if(window.HistoryManager) window.HistoryManager.capture(true);
    let rowsToSort = [];
"""
content = content.replace("    let rowsToSort = [];", sort_history_start)

sort_history_end = """
    handleBodyInput();
    if(window.HistoryManager) window.HistoryManager.capture(true);
}
"""
content = content.replace("    handleBodyInput();\\n}", sort_history_end)

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('History capture added to sort!')
