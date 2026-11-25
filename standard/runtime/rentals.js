import {validateRentalSnapshot} from "../common/rentals.mjs";
const copy=value=>structuredClone(value);
export class RentalLibrary {
  constructor({load}={}) {
    this.load=load??(async()=>{
      // Fixed bundled URL only. Never query the official rental API on a device.
      const response=await fetch(new URL("./rentals/catalog.json",import.meta.url),{credentials:"omit",redirect:"error"});
      if(!response.ok)throw Error("The bundled rental library could not be read. Reinstall the app without deleting your saves.");
      const text=await response.text();
      if(text.length>32*1024*1024)throw Error("The bundled rental library is too large.");
      return JSON.parse(text);
    });
  }
  async snapshot() {
    if(!this.loading)this.loading=Promise.resolve().then(()=>this.load()).then(validateRentalSnapshot).catch(error=>{
      this.loading=null;throw error;
    });
    return this.loading;
  }
  async list(species) {
    if(!Number.isSafeInteger(species)||species<1)throw Error("Choose a valid rental Pokémon.");
    const data=await this.snapshot();
    if(!data.target.species.includes(species))throw Error("This Pokémon is not in the bundled game catalog.");
    return copy(data.entries[species]??[]);
  }
  async index() {
    const data=await this.snapshot();
    return data.target.species.map(species=>{
      const rows=data.entries[species]??[];
      return {species,players:rows.length,top:rows.length?{name:rows[0].name}:null};
    });
  }
}
