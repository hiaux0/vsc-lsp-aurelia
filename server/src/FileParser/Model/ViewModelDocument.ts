interface Property {
  name: string;
  type: string;
}

interface Method {
  parameters: [];
  name: string;
}

export class ViewModelDocument {
  public type: string = '';
  public properties: Property[] = [];
  public methods: Method[] = [];
}
