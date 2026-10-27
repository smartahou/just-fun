#!/usr/bin/env python3
"""CSS debt budget: prevents silent growth while visual ownership is refactored.

Only analyzes project CSS.  Does not rewrite stylesheet, alter app, or scan user media.
"""
import argparse,collections,json,pathlib,re,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
BUDGET=3307  # v7.04: 180 proved-shadowed declarations removed; baseline v7.02 was 3487

def audit():
    rows=[];total=0
    for p in sorted((ROOT/'src/client/styles').glob('*.css')):
        source=p.read_text(encoding='utf8');count=len(re.findall(r'!important\b',source))
        rows.append({'file':p.name,'important':count,'bytes':len(source.encode())})
        total+=count
    return {'baselineVersion':'v7.02','importantBudget':BUDGET,
            'importantCurrent':total,'budgetExceeded':total>BUDGET,
            'files':rows,'guidance':'Visual screenshot/geometry evidence is required when removing old overrides.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    report=audit();print(json.dumps(report,ensure_ascii=False,indent=2))
    path=ROOT/'dist/release-gate-v703/css-audit.json';path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if args.check and report['budgetExceeded']:sys.exit(1)
