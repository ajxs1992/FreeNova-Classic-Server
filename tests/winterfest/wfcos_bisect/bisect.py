import re, subprocess, sys, os
ROOT='/home/ajxs/projects/FreeNova-Classic-Server'
src=os.path.join(ROOT,'game-server/cstrike/addons/amxmodx/scripting/winterfest_cosmetics.sma')
P=os.path.join(ROOT,'tools/build/probe')
lines=open(src,encoding='utf-8').read().split('\n')
blocks=[]
i=0
while i<len(lines):
    l=lines[i]
    if re.match(r'^(public\s+|stock\s+|bool:|[A-Za-z_][A-Za-z0-9_]*\()', l) and not l.startswith('//') and l.rstrip().endswith(')') and not l.rstrip().endswith(';'):
        j=i+1
        while j<len(lines) and lines[j].rstrip()!='}': j+=1
        blocks.append((i,j,l))
        i=j+1
    else: i+=1

def build(stubs):
    out=[]; last=0
    for n,(i,j,hdr) in enumerate(blocks,1):
        if n in stubs:
            out.extend(lines[last:i])
            out.append(hdr); out.append('{'); out.append('\treturn 0;'); out.append('}')
            last=j+1
    out.extend(lines[last:])
    return '\n'.join(out)

def compiles(text):
    open(os.path.join(P,'src','wfcos.sma'),'w').write(text)
    r=subprocess.run(['docker','run','--rm',
        '-v', os.path.join(ROOT,'game-server/cstrike/addons/amxmodx')+':/amx:ro',
        '-v', os.path.join(P,'src')+':/src:ro',
        '-v', os.path.join(P,'out')+':/out',
        '--tmpfs','/work:exec','-w','/work','i386/debian:bookworm-slim','sh','-c',
        'cp -a /amx/scripting/amxxpc /amx/scripting/amxxpc32.so /work/; chmod +x ./amxxpc; ./amxxpc /src/wfcos.sma -i/amx/scripting/include -o/out/out.amxx 2>&1'],
        capture_output=True, text=True)
    o=r.stdout+r.stderr
    return ('bad_alloc' not in o), o.strip().split('\n')[-3:]

if __name__=='__main__':
    spec=sys.argv[1] if len(sys.argv)>1 else ''
    stubs=set()
    for part in spec.split(','):
        if '-' in part:
            a,b=part.split('-'); stubs.update(range(int(a),int(b)+1))
        elif part:
            stubs.add(int(part))
    ok, tail = compiles(build(stubs))
    print('stubs', sorted(stubs)[:3], '...', len(stubs), 'OK' if ok else 'CRASH', tail[-2:])
