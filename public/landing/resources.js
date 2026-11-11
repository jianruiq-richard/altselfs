(function(){
 const menu=document.querySelector('#mainnav'),button=document.querySelector('#menubtn');
 function closeMenu(){menu.classList.remove('open');button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigation')}
 button.addEventListener('click',()=>{const open=menu.classList.toggle('open');button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close navigation':'Open navigation')});
 menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu.classList.contains('open')){closeMenu();button.focus()}});
 document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!button.contains(e.target))closeMenu()});
 document.querySelectorAll('.account-avatar img').forEach(img=>{img.addEventListener('error',()=>img.remove());if(img.complete&&img.naturalWidth===0)img.remove()});
 window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload()});
})();
