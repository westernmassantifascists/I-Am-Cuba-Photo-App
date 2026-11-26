#!/usr/bin/env bash
# Regenerates the placeholder media of the example piece (template/assets) with ffmpeg, and
# Python + Pillow for the transparent letter. Replace every file with your own photographs,
# recordings and film; keep the names, or update library.json and darkroom.json to match.
set -euo pipefail
cd "$(dirname "$0")/../template/assets"
rm -rf bg images music ambience sfx video
mkdir -p bg images music ambience sfx video

FONT=$(fc-match -f '%{file}' 'DejaVu Sans' 2>/dev/null || true)
label() { if [ -n "$FONT" ]; then echo ",drawtext=fontfile=$FONT:text='placeholder  $1':x=20:y=h-34:fontsize=15:fontcolor=white@0.45"; fi; }
# colour casts, so that darkroom develop has colour to find (cool sea, amber rooms, sodium street…)
COOL='rr=0.78:gg=0.92:bb=1.12'; WARM='rr=1.1:gg=0.93:bb=0.7'; SODIUM='rr=1.12:gg=0.86:bb=0.5'; GREEN='rr=0.84:gg=1.0:bb=0.86'; PALE='rr=1.0:gg=0.98:bb=0.95'
img() { # file, geq luminance expression, colour cast
  ffmpeg -v error -y -f lavfi -i "color=c=black:s=1280x720:d=1,format=gray" \
    -vf "geq=lum='$2',noise=alls=16:allf=t,vignette=PI/4.5,format=rgb24,colorchannelmixer=${3:-$PALE},format=yuv420p$(label "$1")" -frames:v 1 -q:v 7 "$1"
}
H='(Y-H*0.5)'
# shore: wide pale sky over a mile of wet sand
img bg/shore.jpg  'if(lt(Y,H*0.45), 170-70*(Y/(H*0.45)), 60+50*(1+sin(Y/1.8+2*sin(X/140)))*0.25*(Y/H)+40*exp(-pow((Y-H*0.47)/8,2)))' "$COOL"
# pier: dark posts marching out to the horizon
img bg/pier.jpg   'if(lt(Y,H*0.5), 150-60*(Y/(H*0.5)), if(lt(abs(mod(X-W/2,90)-45),3+20*(Y/H-0.5))*gt(Y,H*0.52), 15, 55+20*sin(Y/3)))' "$COOL"
# hotel: a dark facade, rows of black windows, one pale curtain
img bg/hotel.jpg  'if(lt(mod(X,110),60)*lt(mod(Y,120),70)*gt(Y,60), if(lt(abs(X-W*0.62),30)*lt(abs(Y-H*0.42),40), 150, 8), 70-30*(Y/H))' "$GREEN"
# bakery: one warm lit window in a dark street
img bg/bakery.jpg '12+200*lt(abs(X-W*0.45),150)*lt(abs(Y-H*0.5),110)*(0.8+0.2*sin(X/9))+30*exp(-pow((X-W*0.45)/300,2))*gt(Y,H*0.62)' "$WARM"
# cliff: a path climbing to an edge over nothing
img bg/cliff.jpg  'if(lt(Y,H*(0.35+0.25*(X/W))), 180-80*(Y/H), if(lt(abs(Y-(H*0.9-0.4*X)),18), 140, 30+10*sin(X/7)*sin(Y/5)))' "$PALE"
# shelter: a lit bus shelter in the rain
img bg/shelter.jpg '20+150*lt(abs(X-W*0.5),180)*lt(abs(Y-H*0.55),100)*(1-0.3*(Y/H))+25*gt(sin(X*0.9+Y*0.15),0.97)' "$SODIUM"
# night sea: almost black water, a line of moonlight
img bg/nightsea.jpg 'if(lt(Y,H*0.48), 25, 8+60*exp(-pow((X-W*0.55)/(18+120*(Y/H-0.48)),2))*(0.5+0.5*sin(Y/2)))' "$COOL"
# house: a dim room, a doorway of light
img bg/house.jpg  '25+170*lt(abs(X-W*0.6),70)*lt(abs(Y-H*0.45),180)+20*lt(abs(X-W*0.25),200)*gt(Y,H*0.7)' "$WARM"
# kitchen: low warm light from one side
img bg/kitchen.jpg '20+150*exp(-pow((X-W*0.15)/(W*0.25),2))*exp(-pow((Y-H*0.4)/(H*0.5),2))' "$WARM"
# title: fog over the sea
img bg/title.jpg  '30+120*exp(-pow((Y-H*0.5)/(H*0.18),2))+30*exp(-pow((X-W*0.5)/(W*0.4),2))' "$COOL"

vid() { # file, seconds, geq expression (T = time), colour cast
  ffmpeg -v error -y -f lavfi -i "color=c=black:s=640x360:d=$2:r=24,format=gray" \
    -vf "geq=lum='$3',noise=alls=12:allf=t,format=rgb24,colorchannelmixer=${4:-$PALE},format=yuv420p$(label "$1")" -an \
    -c:v libx264 -crf 30 -preset slow -movflags +faststart "$1"
}
# waves: light moving on water (background loop)
vid bg/waves.mp4 6 'if(lt(Y,H*0.45), 150-60*(Y/(H*0.45)), 50+40*(1+sin(Y/2.2+2*sin(X/80+T*1.2)+T*2))*0.5*(Y/H))' "$COOL"
# rain on a window (background loop)
vid bg/rainwindow.mp4 6 '40+30*sin(X/60)+120*gt(sin(X*0.7+(Y-T*300)*0.08),0.985)' "$SODIUM"
# tide: the water racing in from the horizon (cut-scene, with sound)
ffmpeg -v error -y -f lavfi -i "color=c=black:s=640x360:d=5:r=24,format=gray" \
  -f lavfi -i "anoisesrc=color=brown:amplitude=0.4:d=5:r=44100" \
  -vf "geq=lum='if(lt(Y,H*0.4), 140-50*(Y/(H*0.4)), if(lt(Y,H*0.4+H*0.6*(T/5)), 30+30*sin(Y/2+T*4), 110))',noise=alls=12:allf=t,format=yuv420p$(label video/tide.mp4)" \
  -af "lowpass=f=900,afade=t=in:d=1,afade=t=out:st=4:d=1" -c:v libx264 -crf 30 -preset slow -c:a aac -b:a 64k -shortest -movflags +faststart video/tide.mp4

# the letter (transparent picture shown over the background)
python3 - <<'PY'
from PIL import Image, ImageDraw, ImageFilter
im = Image.new('RGBA', (900, 620), (0, 0, 0, 0))
paper = Image.new('RGBA', (820, 540), (226, 219, 204, 255))
d = ImageDraw.Draw(paper)
for i, y in enumerate(range(80, 470, 46)):
    d.line([(80, y), (80 + 520 + (i * 97) % 200, y - 4)], fill=(40, 40, 50, 255), width=4)
paper = paper.rotate(-3, expand=True, resample=Image.BICUBIC)
blur = Image.new('RGBA', paper.size, (0, 0, 0, 0))
blur.putalpha(paper.split()[3].point(lambda a: 140 if a else 0))
blur = blur.filter(ImageFilter.GaussianBlur(12))
im.paste(blur, (40, 46), blur)
im.alpha_composite(paper, (24, 20))
im.save('images/letter.png', optimize=True)
PY

tone() { # file, aevalsrc expression — 24 s loops
  ffmpeg -v error -y -f lavfi -i "aevalsrc='$2':s=44100:d=24" -af "lowpass=f=2000" -c:a aac -b:a 64k "$1"
}
tone music/longing.m4a    '0.14*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*t/4))+0.08*sin(2*PI*165*t)*(0.5+0.5*sin(2*PI*t/6))+0.06*sin(2*PI*131*t)*(0.5-0.5*cos(2*PI*t/8))'
tone music/dread.m4a      '0.18*sin(2*PI*55*t)*(0.7+0.3*sin(2*PI*t/3))+0.07*sin(2*PI*58*t)+0.04*sin(2*PI*233*t)*(0.5-0.5*cos(2*PI*t/2))'
tone music/tenderness.m4a '0.10*sin(2*PI*196*t)*(0.6+0.4*sin(2*PI*t/2))+0.08*sin(2*PI*247*t)*(0.5+0.5*sin(2*PI*t/3))+0.07*sin(2*PI*294*t)*(0.5-0.5*cos(2*PI*t/4))'
ffmpeg -v error -y -f lavfi -i "anoisesrc=color=brown:amplitude=0.35:d=12:r=44100" -af "lowpass=f=700,volume='0.6+0.4*sin(2*PI*t/6)':eval=frame" -c:a aac -b:a 64k ambience/waves.m4a
ffmpeg -v error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.25:d=12:r=44100" -af "bandpass=f=500:w=400,volume='0.5+0.5*sin(2*PI*t/4)':eval=frame" -c:a aac -b:a 64k ambience/wind.m4a
ffmpeg -v error -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.25:d=12:r=44100" -af "highpass=f=400,lowpass=f=7000" -c:a aac -b:a 64k ambience/rain.m4a
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.9*sin(2*PI*55*t)*exp(-7*t)+0.4*sin(2*PI*90*t)*exp(-12*t)':s=44100:d=1.2" -c:a aac -b:a 64k sfx/door.m4a

du -sh .
