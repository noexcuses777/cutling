import { REASON_LABELS, type Assessment, type FilterSettings } from '@cutling/shared';
import type { ExtractedResult } from '@cutling/search-adapters';
import { button, node } from './common';
export type ResultCallbacks = { save:()=>Promise<string>; feedback:(type:string)=>Promise<void>; reveal:()=>void; less:()=>Promise<void>; canSave?:()=>boolean };
type SavedProperty = { value:string; priority:string };
/** Keep source nodes in place; only reversible inline properties change. */
export class ResultDecoration {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private original = new Map<HTMLElement,Map<string,SavedProperty>>();
  revealed=false;
  collapsed=false;
  private status: HTMLElement;
  private saving=false;
  private saved=false;
  private statusMessage='';
  private current?:{assessment:Assessment;enabled:boolean;filters:FilterSettings;always:boolean};
  constructor(readonly record: ExtractedResult, private callbacks: ResultCallbacks) {
    this.host=node('div',undefined,{'data-cutling-owned':'result'});this.root=this.host.attachShadow({mode:'open'});
    this.status=node('span');record.element.append(this.host);
  }
  private setStyle(element:HTMLElement,property:string,value:string) {
    let saved=this.original.get(element);if(!saved){saved=new Map();this.original.set(element,saved);}
    if(!saved.has(property))saved.set(property,{value:element.style.getPropertyValue(property),priority:element.style.getPropertyPriority(property)});
    element.style.setProperty(property,value,'important');
  }
  private restoreStyles() {
    for(const [element,properties] of this.original)for(const [property,saved] of properties){
      if(saved.value)element.style.setProperty(property,saved.value,saved.priority);else element.style.removeProperty(property);
    }
    this.original.clear();
  }
  update(assessment: Assessment, enabled:boolean, filters:FilterSettings, always=false) {
    this.current={assessment,enabled,filters,always};this.restoreStyles();
    this.collapsed=enabled&&!this.revealed&&!always&&assessment.recommendedAction==='deemphasize';
    this.host.dataset.cutlingCollapsed=String(this.collapsed);
    if(!enabled){this.host.hidden=true;return;}this.host.hidden=false;
    if(!this.collapsed&&!this.revealed&&!always&&this.callbacks.canSave?.()===false&&['recommend','neutral'].includes(assessment.recommendedAction)){this.host.hidden=true;return;}
    if(this.collapsed){
      // The compact blurred preview occupies the space while all source nodes,
      // event listeners and link destinations stay in their original positions.
      for(const child of this.record.element.children)if(child!==this.host&&child instanceof HTMLElement)this.setStyle(child,'display','none');
      for(const element of [this.record.titleElement,this.record.snippetElement])if(element)this.setStyle(element,'filter','blur(4px)');
      this.setStyle(this.record.element,'min-height','0');this.setStyle(this.record.element,'height','auto');
      this.setStyle(this.record.element,'padding-top','6px');this.setStyle(this.record.element,'padding-bottom','6px');
    }
    this.root.replaceChildren(node('style',`:host{display:block;margin:8px 0;font:12px/1.5 system-ui,-apple-system,'Malgun Gothic',sans-serif;color:#40464f}:host([hidden]){display:none!important}*{box-sizing:border-box}.bar{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.label{font-weight:600;color:#555e69}.preview{filter:blur(3px);user-select:none;max-width:100%;height:17px;overflow:hidden;margin:7px 0 0;color:#777;pointer-events:none}.muted{color:#737b86}button{font:inherit;background:#fff;border:1px solid #dfe2e6;padding:5px 9px;border-radius:5px;color:#303740;cursor:pointer}button:hover{background:#f5f6f7}button:focus-visible,summary:focus-visible{outline:2px solid #485c78;outline-offset:2px}button:disabled{opacity:.55}details{margin-top:5px}summary{cursor:pointer;color:#777;font-size:11px}details[open]{padding:10px;background:#f7f8fa;border-radius:5px}p{margin:6px 0}.feedback{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.status{display:block;margin-top:4px}`));
    const action=assessment.recommendedAction;
    const label=assessment.commercialityLabel==='explicit_ad'?'광고 접음':assessment.reasonCodes.includes('same_url')||assessment.reasonCodes.includes('same_text')?'중복 결과 접음':'검색 목적과 다른 결과 접음';
    const bar=node('div',undefined,{class:'bar'});
    if(this.collapsed)bar.append(node('span',label,{class:'label'}));else if(this.revealed||always)bar.append(node('span','펼친 결과',{class:'muted'}));
    const run=async(fn:()=>Promise<void>)=>{try{await fn();this.statusMessage='반영했어요.';}catch(e){this.statusMessage=(e as Error).message;}this.status.textContent=this.statusMessage;};
    if(this.callbacks.canSave?.()!==false){
      const save=button(this.saved?'담았어요':this.saving?'담는 중…':'자료 담기',async()=>{
        if(this.saving||this.saved)return;this.saving=true;this.statusMessage='자료를 담고 있어요…';this.renderCurrent();
        try{this.statusMessage=await this.callbacks.save();this.saved=true;}catch(e){this.statusMessage=(e as Error).message;}
        finally{this.saving=false;this.renderCurrent();}
      });save.disabled=this.saved||this.saving;bar.append(save);
    }
    if(this.collapsed)bar.append(button('다시 보기',()=>{this.revealed=true;this.update(assessment,enabled,filters,always);this.callbacks.reveal();void run(()=>this.callbacks.feedback('reveal'));}));
    else if(action==='deemphasize'&&this.revealed&&!always)bar.append(button('다시 접기',()=>{this.revealed=false;this.update(assessment,enabled,filters,always);this.callbacks.reveal();}));
    const details=node('details');details.append(node('summary','분류 이유'));
    for(const reason of assessment.reasonCodes)if(REASON_LABELS[reason])details.append(node('p',REASON_LABELS[reason]));
    for(const reason of assessment.evidence.slice(0,3))details.append(node('p',reason));
    details.append(node('p','제목과 검색 요약을 기준으로 판단합니다. 원문에서 다시 확인할 수 있어요.',{class:'muted'}));
    const actions=node('div',undefined,{class:'feedback'});
    actions.append(button('이 사이트는 항상 보기',()=>run(()=>this.callbacks.feedback('always_domain'))),button('덜 가리기',()=>run(this.callbacks.less)));
    if(this.callbacks.canSave?.()!==false)actions.append(button('판단 다시 요청',()=>run(()=>this.callbacks.feedback('reevaluate'))));
    details.append(actions);this.status=node('span',this.statusMessage,{role:'status',class:'status'});
    if(this.collapsed){
      this.root.append(node('style',`:host{margin:2px 0}.bar button{padding:3px 8px}.bar details{margin:0}.bar details[open]{flex-basis:100%}.preview{height:14px;font-size:11px;margin:4px 0 0}.status:empty{display:none}`));
      bar.append(details);
    }
    this.root.append(bar);
    if(this.collapsed)this.root.append(node('p',this.record.result.title,{class:'preview','aria-hidden':'true'}));
    if(!this.collapsed)this.root.append(details);
    this.root.append(this.status);
  }
  private renderCurrent(){if(this.current){const {assessment,enabled,filters,always}=this.current;this.update(assessment,enabled,filters,always);}}
  restore(){this.restoreStyles();this.collapsed=false;this.host.remove();}
}

