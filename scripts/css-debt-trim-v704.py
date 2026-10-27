#!/usr/bin/env python3
"""Conservative v7.04 stylesheet cleanup.

Remove only obsolete `!important` declarations for an EXACT identical selector,
CSS property and @media/@supports context when a later equally-important declaration
is guaranteed to win. Does not attempt specificity heuristics or remove unrelated
selectors. Requires tinycss2 only for maintenance, never for running Just Fun.
"""
import argparse
import collections
from pathlib import Path
import tinycss2

ROOT=Path(__file__).resolve().parents[1]
FILES=['41-reading.css','30-overrides.css']

def trim(source):
    lines=source.splitlines(keepends=True)
    offsets=[0]
    for line in lines:offsets.append(offsets[-1]+len(line))
    decls=[]
    def walk(rules,context=()):
        for rule in rules:
            if rule.type=='at-rule' and rule.content and rule.lower_at_keyword in ('media','supports'):
                label=(rule.lower_at_keyword,tinycss2.serialize(rule.prelude).strip())
                walk(tinycss2.parse_rule_list(rule.content,skip_whitespace=True,skip_comments=True),context+(label,))
            elif rule.type=='qualified-rule':
                selector=tinycss2.serialize(rule.prelude).strip()
                for d in tinycss2.parse_declaration_list(rule.content,skip_whitespace=True,skip_comments=True):
                    if d.type=='declaration' and d.important and not d.lower_name.startswith('--'):
                        start=offsets[d.source_line-1]+d.source_column-1
                        decls.append((context,selector,d.lower_name,start))
    walk(tinycss2.parse_stylesheet(source,skip_whitespace=True,skip_comments=True))
    latest={}
    for context,sel,name,start in decls:latest[(context,sel,name)]=start
    shadows=[(context,sel,name,start) for context,sel,name,start in decls if latest[(context,sel,name)]!=start]
    def end_of_declaration(start):
        # Stay inside a single declaration; respect strings, comments, and functions.
        quote=None;escaped=False;in_comment=False;depth=0;i=start
        while i<len(source):
            ch=source[i];nxt=source[i:i+2]
            if in_comment:
                if nxt=='*/':in_comment=False;i+=2;continue
            elif quote:
                if escaped:escaped=False
                elif ch=='\\':escaped=True
                elif ch==quote:quote=None
            elif nxt=='/*':in_comment=True;i+=2;continue
            elif ch in ('"',"'"):quote=ch
            elif ch in '([':depth+=1
            elif ch in ')]':depth=max(0,depth-1)
            elif depth==0 and ch==';':return i+1
            elif depth==0 and ch=='}':return i
            i+=1
        raise AssertionError('declaration end not found')
    spans=[]
    for context,sel,name,start in shadows:
        end=end_of_declaration(start)
        raw=source[start:end]
        if not raw.lstrip().lower().startswith(name+':') and not __import__('re').match(r'^\s*'+__import__('re').escape(name)+r'\s*:',raw,__import__('re').I):
            raise AssertionError('unexpected declaration range '+raw[:100])
        if '!important' not in raw.lower():raise AssertionError('declaration does not have important '+raw[:100])
        spans.append((start,end))
    for i in range(1,len(sorted(spans))):
        if sorted(spans)[i][0]<sorted(spans)[i-1][1]:raise AssertionError('overlapping declarations')
    for start,end in sorted(spans,reverse=True):source=source[:start]+source[end:]
    return source,len(spans)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    dirty=0
    for name in FILES:
        file=ROOT/'src/client/styles'/name
        before=file.read_text(encoding='utf8')
        after,count=trim(before)
        dirty+=count
        if not args.check:file.write_text(after,encoding='utf8')
        print(f'{name}: shadowed={count}; removable characters={len(before)-len(after)}')
    if args.check and dirty:
        raise SystemExit(f'FAIL: {dirty} shadowed declarations remain')
