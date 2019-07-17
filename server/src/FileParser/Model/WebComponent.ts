import {HtmlTemplateDocument} from './HtmlTemplateDocument';
import {ViewModelDocument} from './ViewModelDocument';

interface Class {
  name: string;
  methods: any;
}

export class WebComponent {
  constructor(public name: string) {

  }

  public document: HtmlTemplateDocument= new HtmlTemplateDocument();
  public viewModel: ViewModelDocument = new ViewModelDocument();

  public paths: string[] = [];

  public classes: Class[] = [];
}
