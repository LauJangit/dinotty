pub const INJECT_SCRIPT_INTERNAL: &str = r#"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
var defined=window.__dinotty_proxy_port;
if(!defined){
var PORT=document.currentScript.getAttribute('data-port');
var HOST=document.currentScript.getAttribute('data-host');
window.__dinotty_proxy_port=PORT;
window.__dinotty_proxy_host=HOST;
function notifyNav(){
var m=location.pathname.match(/^\/preview\/(?:([^\/]+?)\/)?(\d+)(\/.*)?$/);
if(!m)return;
var h=m[1]||'127.0.0.1',pt=m[2],path=m[3]||'/';
var real='http://'+h+':'+pt+path+location.search+location.hash;
window.parent.postMessage({type:'proxy-navigate',url:real},'*');
}
notifyNav();
function rewrite(u){
try{var p=new URL(u,location.href);
var h=p.hostname;
if(h===HOST||h==='127.0.0.1'||h==='localhost'||h==='0.0.0.0'||h===location.hostname){
var pt=(p.port&&p.port!==location.port)?p.port:PORT;
var prefix=(HOST==='127.0.0.1')?'/preview/'+pt:'/preview/'+HOST+'/'+pt;
return prefix+p.pathname+p.search+p.hash;}
}catch(e){}
return null;
}
document.addEventListener('click',function(e){
var a=e.target.closest('a');
if(!a||!a.href)return;
var r=rewrite(a.href);
if(r){e.preventDefault();location.href=r;}
},true);
document.addEventListener('submit',function(e){
var f=e.target;if(!f||!f.action)return;
var r=rewrite(f.action);
if(r){f.action=r;}
},true);
var _open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
var r=rewrite(u);
return _open.apply(this,[m,r||u].concat([].slice.call(arguments,2)));
};
var _fetch=window.fetch;
window.fetch=function(u,o){
if(typeof u==='string'){var r=rewrite(u);if(r)u=r;}
else if(u instanceof Request){var r2=rewrite(u.url);if(r2)u=new Request(r2,u);}
return _fetch.call(this,u,o);
};
var _WebSocket=window.WebSocket;
window.WebSocket=function(u,p){
if(typeof u==='string'){
try{var parsed=new URL(u,location.href);
var h=parsed.hostname;
if(h===HOST||h==='127.0.0.1'||h==='localhost'||h==='0.0.0.0'||h===location.hostname){
var pt=(parsed.port&&parsed.port!==location.port)?parsed.port:PORT;
var prefix=(HOST==='127.0.0.1')?'/preview/'+pt:'/preview/'+HOST+'/'+pt;
var wsProto=location.protocol==='https:'?'wss:':'ws:';
u=wsProto+'//'+location.host+prefix+parsed.pathname+parsed.search;
}}catch(e){}}
return p!==undefined?new _WebSocket(u,p):new _WebSocket(u);
};
window.WebSocket.prototype=_WebSocket.prototype;
window.WebSocket.CONNECTING=_WebSocket.CONNECTING;
window.WebSocket.OPEN=_WebSocket.OPEN;
window.WebSocket.CLOSING=_WebSocket.CLOSING;
window.WebSocket.CLOSED=_WebSocket.CLOSED;
var _EventSource=window.EventSource;
if(_EventSource){
window.EventSource=function(u,o){
if(typeof u==='string'){var r=rewrite(u);if(r)u=r;}
return new _EventSource(u,o);
};
window.EventSource.prototype=_EventSource.prototype;
window.EventSource.CONNECTING=_EventSource.CONNECTING;
window.EventSource.OPEN=_EventSource.OPEN;
window.EventSource.CLOSED=_EventSource.CLOSED;
}
var _pushState=history.pushState;
history.pushState=function(){var r=_pushState.apply(this,arguments);notifyNav();return r;};
var _replaceState=history.replaceState;
history.replaceState=function(){var r=_replaceState.apply(this,arguments);notifyNav();return r;};
window.addEventListener('popstate',function(){notifyNav();});
}
})();</script>"#;

pub const INJECT_SCRIPT_EXTERNAL: &str = r#"<script>(function(){
window.parent.postMessage({type:'preview-ready'},'*');
window.addEventListener('error',function(e){
window.parent.postMessage({type:'preview-error',message:e.message,source:e.filename,line:e.lineno},'*');
});
if(window.__dinotty_ext_proxy)return;
window.__dinotty_ext_proxy=true;
var BASE=document.currentScript.getAttribute('data-base-url')||'';
function notifyNav(url){
window.parent.postMessage({type:'proxy-navigate',url:url},'*');
}
function realUrl(){
var h=location.href;
var m=h.match(/[?&]url=([^&]+)/);
if(m)try{return decodeURIComponent(m[1]);}catch(e){}
if(BASE)return BASE;
return h;
}
notifyNav(realUrl());
function proxyUrl(u){
try{
if(!u||u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('javascript:')||u.startsWith('#'))return null;
var abs;
if(/^https?:\/\//i.test(u)){abs=u;}
else if(/^\/\//.test(u)){abs='https:'+u;}
else if(BASE){abs=new URL(u,BASE).href;}
else{return null;}
if(abs.indexOf('/api/proxy')!==-1)return null;
return'/api/proxy?url='+encodeURIComponent(abs);
}catch(e){return null;}
}
function extractReal(u){
var m=u.match(/\/api\/proxy\?url=([^&]+)/);
if(m)try{return decodeURIComponent(m[1]);}catch(e){}
return null;
}
document.addEventListener('click',function(e){
var a=e.target.closest?e.target.closest('a'):null;
if(!a||!a.href)return;
var href=a.href;
var real=extractReal(href);
if(real){
e.preventDefault();
notifyNav(real);
location.href=href;
return;
}
var t=a.getAttribute('target');
if(t==='_blank'){
var r=proxyUrl(href);
if(r){e.preventDefault();window.open(r,'_blank');}
return;
}
var r2=proxyUrl(href);
if(r2){e.preventDefault();notifyNav(href);location.href=r2;}
},true);
document.addEventListener('submit',function(e){
var f=e.target;if(!f)return;
var action=f.getAttribute('action')||f.action||'';
var realAction=extractReal(action)||action;
var target=proxyUrl(realAction);
if(!target&&action.indexOf('/api/proxy')!==-1){
target=action;
}
if(!target)return;
if((f.method||'GET').toUpperCase()==='GET'){
e.preventDefault();
var fd=new FormData(f);
var params=new URLSearchParams(fd).toString();
var baseReal=extractReal(target)||realAction;
var sep=baseReal.indexOf('?')!==-1?'&':'?';
var fullUrl=baseReal+sep+params;
var proxied='/api/proxy?url='+encodeURIComponent(fullUrl);
notifyNav(fullUrl);
location.href=proxied;
}else{
f.action=target;
}
},true);
var _open=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
var r=proxyUrl(u);
return _open.apply(this,[m,r||u].concat([].slice.call(arguments,2)));
};
var _fetch=window.fetch;
window.fetch=function(u,o){
if(typeof u==='string'){var r=proxyUrl(u);if(r)u=r;}
else if(u instanceof Request){var r2=proxyUrl(u.url);if(r2)u=new Request(r2,u);}
return _fetch.call(this,u,o);
};
var _wopen=window.open;
window.open=function(u,n,f){
if(typeof u==='string'){var r=proxyUrl(u);if(r)u=r;}
return _wopen.call(this,u,n,f);
};
var _pushState=history.pushState;
history.pushState=function(){
var r=_pushState.apply(this,arguments);
notifyNav(realUrl());
return r;
};
var _replaceState=history.replaceState;
history.replaceState=function(){
var r=_replaceState.apply(this,arguments);
notifyNav(realUrl());
return r;
};
window.addEventListener('popstate',function(){notifyNav(realUrl());});
})();</script>"#;
