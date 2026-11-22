from PIL import Image
p=r"C:\Users\conts\Desktop\FREENOVA System\battlepass example 2.PNG"
im=Image.open(p).convert("L")
w,h=im.size
# downsample to 40x30 brightness map
cw, ch = 40, 30
cells=[]
for y in range(ch):
    row=[]
    for x in range(cw):
        box=(int(x*w/cw), int(y*h/ch), int((x+1)*w/cw), int((y+1)*h/ch))
        c=im.crop(box)
        m=sum(c.getdata())//max(1,c.size[0]*c.size[1])
        row.append(m)
    cells.append(row)
print("map", w, h)
for y,row in enumerate(cells):
    line="".join(" .:+#@"[min(5,m//40)] for m in row)
    print(f"{y:02d} {line}")
# highlight gold-ish from RGB
imc=Image.open(p).convert("RGB")
gold=0; cyan=0; lime=0
px=imc.load()
for y in range(0,h,4):
    for x in range(0,w,4):
        r,g,b=px[x,y]
        if r>140 and g>110 and b<90: gold+=1
        if b>r+20 and b>g: cyan+=1
        if g>r+30 and g>b+20: lime+=1
print("gold-ish", gold, "cyan-ish", cyan, "lime-ish", lime)
