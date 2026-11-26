import {gatewayRequest} from "../common/internet-coop.mjs";
import {allowLanBrokerPermission} from "./protocol.mjs";
export function configureBrokerSession(broker,{gateway,trusted,phase,microphone=()=>false}){
  // This nonpersistent session belongs ONLY to native-owned broker windows.
  // Chromium preflights may have no WebContents id; checking that id on a
  // shared game session would reject legitimate CORS. Never exempt the game.
  broker.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*","ftp://*/*"]},
    (request,callback)=>callback({cancel:!gatewayRequest(request.url,gateway)}));
  broker.setPermissionCheckHandler((contents,permission,origin,details)=>allowLanBrokerPermission(permission,origin,{
    trusted:trusted(contents),isMainFrame:details.isMainFrame,phase:phase(),
    microphone:microphone(),mediaTypes:details.mediaType?[details.mediaType]:[],
  }));
  broker.setPermissionRequestHandler((contents,permission,callback,details)=>callback(allowLanBrokerPermission(permission,details.requestingUrl,{
    trusted:trusted(contents),isMainFrame:details.isMainFrame,phase:phase(),
    microphone:microphone(),mediaTypes:details.mediaTypes,
  })));
  broker.on("will-download",(_event,item)=>item.cancel());
}
