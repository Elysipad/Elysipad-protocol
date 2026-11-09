import struct, sys, glob, os, zlib
import numpy as np
from PIL import Image
from sklearn.cluster import KMeans
ct = {0:'grayscale',2:'RGB',3:'indexed',4:'gray+alpha',6:'RGBA'}
for f in sorted(glob.glob('brand/*')+glob.glob('reference/*')):
    b = open(f,'rb').read()
    print('==', f, len(b), 'bytes')
    im = Image.open(f); print(' format',im.format,'mode',im.mode,'size',im.size)
    if b[:8]==b'\x89PNG\r\n\x1a\n':
        w,h,bd,c,_,_,il = struct.unpack('>IIBBBBB', b[16:29])
        print(' IHDR',w,h,'bitdepth',bd,'colortype',c,ct[c],'interlace',il)
        chunks=[];p=8
        while p<len(b):
            n=struct.unpack('>I',b[p:p+4])[0];chunks.append(b[p+4:p+8].decode());p+=12+n
        print(' chunks',sorted(set(chunks)))
    a = np.array(im.convert('RGBA'))
    al = a[...,3]
    hist = np.bincount(al.ravel(),minlength=256)
    print(' alpha: min',al.min(),'max',al.max(),'distinct',(hist>0).sum(),'a==0:',hist[0],'a==255:',hist[255],'partial:',hist[1:255].sum())
    z = (al==0)
    if z.any():
        rgb0 = a[z][:,:3]; print(' transparent px rgb: pure black frac', float((rgb0.sum(1)==0).mean()))
    else: print(' no transparent pixels')
    px = a[::4,::4,:3].reshape(-1,3).astype(float)
    km = KMeans(6,n_init=4,random_state=1).fit(px)
    cnt = np.bincount(km.labels_)
    full = a[...,:3]
    for i in np.argsort(-cnt):
        c = km.cluster_centers_[i]
        d = ((full[::2,::2].astype(float)-c)**2).sum(2)
        yy,xx = np.unravel_index(d.argmin(),d.shape); yy*=2;xx*=2
        print('  cluster %.1f%% centre %s snapped #%02x%02x%02x at (x=%d,y=%d)'%(100*cnt[i]/len(px),np.round(c).astype(int),*full[yy,xx],xx,yy))
