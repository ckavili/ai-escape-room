// Parse SSE frames across arbitrary UTF-8 chunks, including CRLF and multiline data.
export async function* readEvents(body) {
  const reader=body.getReader();const decoder=new TextDecoder();let buffer='',data=[],event='message';
  const line=text=>{
    if(text===''){const result=data.length?{event,data:data.join('\n')}:null;data=[];event='message';return result;}
    if(text.startsWith('data:'))data.push(text.slice(5).replace(/^ /,''));
    if(text.startsWith('event:'))event=text.slice(6).trim();
    return null;
  };
  try {
    while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      let index;while((index=buffer.indexOf('\n'))>=0){const item=line(buffer.slice(0,index).replace(/\r$/,''));buffer=buffer.slice(index+1);if(item)yield item;}
      if(done){if(buffer)line(buffer.replace(/\r$/,''));const item=line('');if(item)yield item;break;}
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
