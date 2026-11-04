import sys
from PIL import Image
files=sys.argv[2:]; out=sys.argv[1]
ims=[Image.open(f) for f in files]; w,h=ims[0].size; cols=2; rows=(len(ims)+1)//2
sheet=Image.new('RGB',(w*cols,h*rows))
for i,im in enumerate(ims): sheet.paste(im,((i%cols)*w,(i//cols)*h))
sheet.resize((w*cols//2,h*rows//2)).save(out)
