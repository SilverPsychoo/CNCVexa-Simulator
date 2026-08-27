const fnMap = {
  SIN: x => Math.sin(x * Math.PI / 180), COS: x => Math.cos(x * Math.PI / 180),
  TAN: x => Math.tan(x * Math.PI / 180), ASIN: x => Math.asin(x) * 180 / Math.PI,
  ACOS: x => Math.acos(x) * 180 / Math.PI, ATAN: x => Math.atan(x) * 180 / Math.PI,
  SQRT: Math.sqrt, ABS: Math.abs, ROUND: Math.round, FIX: Math.floor, FUP: Math.ceil,
  EXP: Math.exp, LN: Math.log
};

function tokenize(src, variables){
  const out=[]; let i=0; const s=src.toUpperCase().trim();
  while(i<s.length){
    if(/\s/.test(s[i])){i++;continue;}
    if(s[i]==='#'){
      i++; let n='';
      if(s[i]==='['){ let depth=1,j=++i; while(i<s.length&&depth){if(s[i]==='[')depth++;if(s[i]===']')depth--;i++;} n=String(Math.trunc(evaluateExpression(s.slice(j,i-1),variables))); }
      else {while(i<s.length&&/\d/.test(s[i]))n+=s[i++];}
      if(!n) throw new Error('Variable Macro incompleta'); out.push({t:'num',v:Number(variables.get(Number(n))??0)}); continue;
    }
    const num=s.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:E[+\-]?\d+)?/);
    if(num){out.push({t:'num',v:Number(num[0])});i+=num[0].length;continue;}
    const word=s.slice(i).match(/^[A-Z]+/);
    if(word){const w=word[0];i+=w.length;out.push({t:fnMap[w]?'fn':'op',v:w});continue;}
    const two=s.slice(i,i+2);
    if(['**','>=','<=','==','!='].includes(two)){out.push({t:'op',v:two});i+=2;continue;}
    if('+-*/()[],<>'.includes(s[i])){out.push({t:'op',v:s[i]==='['?'(':s[i]===']'?')':s[i]});i++;continue;}
    throw new Error(`Símbolo no válido en expresión: ${s[i]}`);
  }
  return out;
}

const prec={OR:1,XOR:2,AND:3,EQ:4,NE:4,GT:4,LT:4,GE:4,LE:4,'==':4,'!=':4,'>':4,'<':4,'>=':4,'<=':4,'+':5,'-':5,'*':6,'/':6,MOD:6,'**':7};
const rightAssoc=new Set(['**']);
function toRpn(tokens){
  const out=[],ops=[]; let prev=null;
  for(const token of tokens){
    if(token.t==='num')out.push(token);
    else if(token.t==='fn')ops.push(token);
    else if(token.v===','){while(ops.length&&ops.at(-1).v!=='(')out.push(ops.pop());}
    else if(token.v==='(')ops.push(token);
    else if(token.v===')'){
      while(ops.length&&ops.at(-1).v!=='(')out.push(ops.pop());
      if(!ops.length)throw new Error('Paréntesis desbalanceados'); ops.pop(); if(ops.length&&ops.at(-1).t==='fn')out.push(ops.pop());
    } else {
      let op=token.v;
      if((op==='+'||op==='-')&&(!prev||prev.t==='op'&&prev.v!==')')) op=op==='-'?'NEG':'POS';
      const p=op==='NEG'||op==='POS'?8:(prec[op]??0);
      while(ops.length&&ops.at(-1).v!=='('&&ops.at(-1).t!=='fn'){
        const top=ops.at(-1).v,tp=top==='NEG'||top==='POS'?8:(prec[top]??0);
        if(tp>p||(tp===p&&!rightAssoc.has(op)))out.push(ops.pop());else break;
      }
      ops.push({t:'op',v:op});
    }
    prev=token;
  }
  while(ops.length){if(ops.at(-1).v==='(')throw new Error('Paréntesis desbalanceados');out.push(ops.pop());}
  return out;
}

export function evaluateExpression(src,variables=new Map()){
  const rpn=toRpn(tokenize(String(src).replace(/\bGT\b/g,'>').replace(/\bLT\b/g,'<').replace(/\bGE\b/g,'>=').replace(/\bLE\b/g,'<='),variables));
  const st=[];
  for(const t of rpn){
    if(t.t==='num')st.push(t.v);
    else if(t.t==='fn'){const a=st.pop();const v=fnMap[t.v](a);if(!Number.isFinite(v))throw new Error(`Resultado inválido en ${t.v}`);st.push(v);}
    else if(t.v==='NEG'||t.v==='POS'){const a=st.pop();st.push(t.v==='NEG'?-a:+a);}
    else {const b=st.pop(),a=st.pop();let v;
      switch(t.v){case'+':v=a+b;break;case'-':v=a-b;break;case'*':v=a*b;break;case'/':if(b===0)throw new Error('División entre cero');v=a/b;break;case'MOD':v=a%b;break;case'**':v=a**b;break;case'>':case'GT':v=+(a>b);break;case'<':case'LT':v=+(a<b);break;case'>=':case'GE':v=+(a>=b);break;case'<=':case'LE':v=+(a<=b);break;case'EQ':case'==':v=+(a===b);break;case'NE':case'!=':v=+(a!==b);break;case'AND':v=+(!!a&&!!b);break;case'OR':v=+(!!a||!!b);break;case'XOR':v=+(!!a!==!!b);break;default:throw new Error(`Operador no soportado: ${t.v}`)} st.push(v);
    }
  }
  if(st.length!==1)throw new Error('Expresión Macro inválida'); return st[0];
}

export function evaluateCondition(src,variables){return !!evaluateExpression(src,variables);}
