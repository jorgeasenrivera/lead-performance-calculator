import {generateProposal} from './generation.mjs';
self.onmessage=({data})=>{try{self.postMessage({proposal:generateProposal(data)});}catch(error){self.postMessage({error:error.message});}};
